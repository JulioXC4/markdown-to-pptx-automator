import axios from 'axios';
import GithubSlugger from 'github-slugger';
import * as p from '@clack/prompts';
import path from 'path';

// Configurar cliente de Axios con autenticación de GitHub
const getGithubClient = (token) => {
  return axios.create({
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3.raw', // Descargar contenido directamente en texto crudo
      'User-Agent': 'Markdown-to-PPTX-Automator'
    }
  });
};

/**
 * Resuelve una ruta de imagen local de forma relativa a la ubicación del archivo markdown
 */
function resolveRepoPath(filePath, imgPath) {
  // Si es una URL remota, dejarla tal cual
  if (imgPath.startsWith('http://') || imgPath.startsWith('https://') || imgPath.startsWith('//')) {
    return imgPath;
  }
  
  // Obtener directorio del archivo markdown
  const dir = path.posix.dirname(filePath);
  // Unir usando posix
  let joined = path.posix.join(dir, imgPath);
  
  // Limpiar cualquier prefijo que intente escapar de la raíz del repositorio
  joined = joined.replace(/^(\.\.\/|\.\/|\/)+/, '');
  return joined;
}

/**
 * Descarga y parsea el archivo de índice (00-cover.md) para mapear las secciones
 */
export async function parseIndex(repo, branch, tocPath, token) {
  const client = getGithubClient(token);
  const url = `https://api.github.com/repos/${repo}/contents/${tocPath}?ref=${branch}`;
  
  try {
    const response = await client.get(url);
    const content = response.data;
    
    const lines = content.split('\n');
    const sections = [];
    
    // Regex para detectar enlaces de Markdown: [Texto](archivo#anchor) o [Texto](archivo)
    const linkRegex = /\[([^\]]+)\]\(([^)#\s]+)(?:#([^)\s]+))?\)/;
    
    for (const line of lines) {
      const match = line.match(linkRegex);
      if (match) {
        const text = match[1].trim();
        const file = match[2].trim();
        const anchor = match[3] ? match[3].trim() : null;
        
        // Intentar extraer el número de sección del texto (ej. "5.1. Style Guidelines" -> "5.1")
        const numMatch = text.match(/^(\d+(?:\.\d+)*)/);
        const number = numMatch ? numMatch[1] : null;
        
        sections.push({
          number,
          text,
          file,
          anchor
        });
      }
    }
    
    return sections;
  } catch (error) {
    throw new Error(`[ERROR] Error al descargar o parsear el indice (${tocPath}) en GitHub: ${error.message}`);
  }
}

/**
 * Busca el índice del encabezado en el array de encabezados que corresponde a la sección dada
 */
function findHeadingIndex(headings, section) {
  // 1. Coincidencia por slug exacto
  if (section.anchor) {
    const idx = headings.findIndex(h => h.slug === section.anchor);
    if (idx !== -1) return idx;
  }
  
  // 2. Coincidencia por número de sección (ej. "5.1" o "5.1.")
  if (section.number) {
    const escapedNum = section.number.replace(/\./g, '\\.');
    const numRegex = new RegExp(`^${escapedNum}\\b`);
    const idx = headings.findIndex(h => numRegex.test(h.text));
    if (idx !== -1) return idx;
  }
  
  // 3. Coincidencia por inclusión de título
  const idx = headings.findIndex(h => h.text.toLowerCase().includes(section.text.toLowerCase()));
  return idx;
}

/**
 * Descarga y extrae el texto en el rango de secciones especificado
 */
export async function extractRangeContent(repo, branch, sections, startSecNum, endSecNum, token) {
  const client = getGithubClient(token);
  
  // 1. Encontrar índices globales del rango en el índice (TOC)
  const startIndex = sections.findIndex(s => s.number === startSecNum || s.text.startsWith(startSecNum));
  const endIndex = sections.findIndex(s => s.number === endSecNum || s.text.startsWith(endSecNum));
  
  if (startIndex === -1) {
    throw new Error(`[ERROR] Seccion de inicio "${startSecNum}" no encontrada en el indice.`);
  }
  if (endIndex === -1) {
    throw new Error(`[ERROR] Seccion de fin "${endSecNum}" no encontrada en el indice.`);
  }
  if (startIndex > endIndex) {
    throw new Error(`[ERROR] La seccion de inicio "${startSecNum}" esta despues de la seccion de fin "${endSecNum}".`);
  }
  
  const activeSections = sections.slice(startIndex, endIndex + 1);
  
  // 2. Agrupar secciones por archivo físico manteniendo el orden original
  const filesToProcess = [];
  for (const sec of activeSections) {
    let lastFileObj = filesToProcess[filesToProcess.length - 1];
    if (!lastFileObj || lastFileObj.file !== sec.file) {
      lastFileObj = { file: sec.file, sections: [] };
      filesToProcess.push(lastFileObj);
    }
    lastFileObj.sections.push(sec);
  }
  
  let consolidatedContent = '';
  const images = []; // Contendra objetos { original, resolved }
  
  // 3. Descargar y parsear cada archivo
  for (const fileObj of filesToProcess) {
    const fileUrl = `https://api.github.com/repos/${repo}/contents/${fileObj.file}?ref=${branch}`;
    
    p.log.info(`[INFO] Descargando contenido de: ${fileObj.file}...`);
    const response = await client.get(fileUrl);
    const fileContent = response.data;
    
    // Extraer todos los encabezados del archivo
    const headings = [];
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;
    while ((match = headingRegex.exec(fileContent)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        index: match.index,
        length: match[0].length
      });
    }
    
    // Asignar slugs estilo GitHub
    const slugger = new GithubSlugger();
    headings.forEach(h => {
      h.slug = slugger.slug(h.text);
    });
    
    // Identificar el rango de texto en el archivo
    const firstActiveSec = fileObj.sections[0];
    const lastActiveSec = fileObj.sections[fileObj.sections.length - 1];
    
    const startHeadingIdx = findHeadingIndex(headings, firstActiveSec);
    if (startHeadingIdx === -1) {
      p.log.warn(`[WARN] No se encontro el encabezado en el archivo para la seccion: "${firstActiveSec.text}". Se leera desde el inicio.`);
    }
    
    const startCharPos = startHeadingIdx !== -1 ? headings[startHeadingIdx].index : 0;
    let endCharPos = fileContent.length;
    
    // Buscar la siguiente sección inactiva en el índice global que pertenezca al mismo archivo
    const lastActiveGlobalIdx = sections.findIndex(s => s === lastActiveSec);
    let nextInactiveSecInFile = null;
    for (let i = lastActiveGlobalIdx + 1; i < sections.length; i++) {
      if (sections[i].file === lastActiveSec.file) {
        nextInactiveSecInFile = sections[i];
        break;
      }
    }
    
    if (nextInactiveSecInFile) {
      const endHeadingIdx = findHeadingIndex(headings, nextInactiveSecInFile);
      if (endHeadingIdx !== -1) {
        endCharPos = headings[endHeadingIdx].index;
      }
    }
    
    const chunkText = fileContent.substring(startCharPos, endCharPos).trim();
    consolidatedContent += `\n\n${chunkText}`;
    
    // Extraer imágenes del chunk actual
    // Imagen markdown: ![alt](url)
    const mdImageRegex = /!\[([^\]]*)\]\(([^)#\s?]+)(?:\?[^)]+)?\)/g;
    while ((match = mdImageRegex.exec(chunkText)) !== null) {
      const imgPath = match[2].trim();
      const resolved = resolveRepoPath(fileObj.file, imgPath);
      if (!images.some(img => img.original === imgPath)) {
        images.push({ original: imgPath, resolved });
      }
    }
    
    // Imagen HTML: <img src="url" />
    const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = htmlImageRegex.exec(chunkText)) !== null) {
      const imgPath = match[1].trim();
      const resolved = resolveRepoPath(fileObj.file, imgPath);
      if (!images.some(img => img.original === imgPath)) {
        images.push({ original: imgPath, resolved });
      }
    }
  }
  
  return {
    content: consolidatedContent.trim(),
    images
  };
}

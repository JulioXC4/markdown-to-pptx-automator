import * as p from '@clack/prompts';
import dotenv from 'dotenv';
import fs from 'fs';
import axios from 'axios';

// Cargar variables de entorno
dotenv.config();

const CACHE_FILE = '.cache_payload.json';

export function cleanPptxPath(rawPath) {
  if (!rawPath) return '';
  let clean = rawPath.trim();
  
  // Eliminar el operador de PowerShell "& " al inicio
  if (clean.startsWith('&')) {
    clean = clean.substring(1).trim();
  }
  
  // Limpiar comillas iniciales y finales
  clean = clean.replace(/^['"]|['"]$/g, '').trim();
  
  // Buscar un patrón de ruta de Windows o POSIX que termine en .pptx
  if (clean.includes('.pptx')) {
    const winMatch = clean.match(/([A-Za-z]:[\\/][^&"'\n\r]+\.pptx)/i);
    if (winMatch) {
      return winMatch[1].trim();
    }
    const posixMatch = clean.match(/(\/[A-Za-z]\/[^&"'\n\r]+\.pptx)/i);
    if (posixMatch) {
      return posixMatch[1].trim();
    }
    const genericMatch = clean.match(/([^&"'\n\r]+\.pptx)/i);
    if (genericMatch) {
      return genericMatch[1].trim();
    }
  }
  
  return clean;
}

export function parseKeepSlides(input) {
  const result = new Set();
  const parts = input.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const rangeParts = trimmed.split('-');
      if (rangeParts.length === 2) {
        const start = parseInt(rangeParts[0].trim(), 10);
        const end = parseInt(rangeParts[1].trim(), 10);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            result.add(i);
          }
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num)) {
        result.add(num);
      }
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

export function validateEnv() {
  const missing = [];
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
  
  if (missing.length > 0) {
    throw new Error(`Faltan las siguientes variables de entorno en el archivo .env: ${missing.join(', ')}`);
  }
}

export function checkCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (data && data.content && data.config) {
        return data;
      }
    } catch (e) {
      // Ignorar caché corrupta
    }
  }
  return null;
}

export async function runCli() {
  p.intro('Markdown to PPTX Automator CLI');
  
  validateEnv();

  let isFromCache = false;
  let cacheData = null;
  let repo, branch, tocPath, title, course, startSection, endSection, basePptxPath;
  let keepSlidesInput = '';

  // Verificar si hay caché guardada
  const cache = checkCache();
  if (cache) {
    p.log.info(`[INFO] Se detecto informacion local de: ${cache.config.repo} (Secciones ${cache.config.startSection} a ${cache.config.endSection}).`);
    
    const action = await p.select({
      message: 'Se encontro un estado anterior guardado. ¿Que deseas hacer?',
      options: [
        { value: 'resume', label: 'Usar datos locales: Saltar directamente al resumen con la IA usando lo que ya se descargo.' },
        { value: 'new', label: 'Nueva extraccion: Ignorar el cache y solicitar todos los datos de GitHub desde cero.' }
      ]
    });
    
    if (p.isCancel(action)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }
    
    if (action === 'resume') {
      isFromCache = true;
      cacheData = cache;
      repo = cache.config.repo;
      branch = cache.config.branch;
      tocPath = cache.config.tocPath;
      title = cache.config.title;
      course = cache.config.course || 'Ingenieria de Software';
      startSection = cache.config.startSection;
      endSection = cache.config.endSection;
      basePptxPath = cache.config.basePptxPath || '';
      keepSlidesInput = cache.config.keepSlidesInput || '';
    } else {
      try {
        fs.unlinkSync(CACHE_FILE);
      } catch (e) {
        // Ignorar error al borrar
      }
    }
  }

  // Si no viene de caché, preguntamos las variables de GitHub y el archivo base con validaciones
  if (!isFromCache) {
    // 1. Preguntar por archivo base (opcional) con validación local fail-fast
    while (true) {
      const baseInput = await p.text({
        message: 'Ruta del PPTX base exportado de Canva (Tip: Arrastra y suelta el archivo aquí, o presiona Enter para omitir):',
        placeholder: 'Presiona Enter si no deseas usar plantilla base'
      });

      if (p.isCancel(baseInput)) {
        p.cancel('Operacion cancelada por el usuario.');
        throw new Error('CANCELLED');
      }

      if (!baseInput) {
        basePptxPath = '';
        break; // Omitir es válido
      }

      const cleanPath = cleanPptxPath(baseInput);
      if (!fs.existsSync(cleanPath)) {
        p.log.error('[ERROR] El archivo base no existe en la ruta especificada.');
        continue;
      }

      try {
        fs.accessSync(cleanPath, fs.constants.R_OK | fs.constants.W_OK);
        // Intentar abrir en modo r+ para detectar EBUSY temprano
        const fd = fs.openSync(cleanPath, 'r+');
        fs.closeSync(fd);
        basePptxPath = cleanPath;
        break;
      } catch (err) {
        p.log.error('[ERROR] El archivo no tiene permisos de lectura/escritura o está bloqueado por otro programa (EBUSY).');
      }
    }

    // 2. Loop de validación de GitHub (fail-fast)
    while (true) {
      repo = await p.text({
        message: '1. Introduce el repositorio de GitHub (owner/repo):',
        placeholder: 'ej. organizacion/nombre-repositorio',
        validate: (value) => {
          if (!value) return 'El repositorio es obligatorio';
          if (!value.includes('/') || value.split('/').length !== 2) {
            return 'Debe tener el formato: owner/repo';
          }
        }
      });
      
      if (p.isCancel(repo)) {
        p.cancel('Operacion cancelada por el usuario.');
        throw new Error('CANCELLED');
      }

      branch = await p.text({
        message: '2. Rama del repositorio:',
        placeholder: 'main',
        defaultValue: 'main'
      });

      if (p.isCancel(branch)) {
        p.cancel('Operacion cancelada por el usuario.');
        throw new Error('CANCELLED');
      }

      // Validación inmediata con API de GitHub
      const s = p.spinner();
      s.start('Validando repositorio y rama en GitHub...');
      try {
        const client = axios.create({
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            'User-Agent': 'Markdown-to-PPTX-Automator'
          }
        });
        await client.get(`https://api.github.com/repos/${repo}/branches/${branch}`);
        s.stop('[OK] Repositorio y rama validados con exito.');
        break; // Validación exitosa, continuar flujo
      } catch (err) {
        s.stop('[ERROR] Acceso fallido.');
        p.log.error('[ERROR] No se pudo acceder al repositorio o la rama no existe. Verifica los datos y tu conexión.');
      }
    }

    tocPath = await p.text({
      message: '3. Ruta del archivo indice (Tabla de Contenidos):',
      placeholder: '00-cover.md',
      defaultValue: '00-cover.md'
    });

    if (p.isCancel(tocPath)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }

    title = await p.text({
      message: '4. Titulo de la presentacion:',
      placeholder: 'Resumen de Documentacion',
      validate: (value) => {
        if (!value) return 'El titulo es obligatorio';
      }
    });

    if (p.isCancel(title)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }

    course = await p.text({
      message: '5. ¿Para que curso o tematica es esta presentacion? (Ej. Diseno de Experimentos, Ingenieria de Software):',
      placeholder: 'ej. Ingenieria de Software',
      validate: (value) => {
        if (!value) return 'El curso o tematica es obligatorio';
      }
    });

    if (p.isCancel(course)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }

    startSection = await p.text({
      message: '6. Seccion de inicio en el indice:',
      placeholder: 'ej. 5.1',
      validate: (value) => {
        if (!value) return 'La seccion de inicio es obligatoria';
      }
    });

    if (p.isCancel(startSection)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }

    endSection = await p.text({
      message: '7. Seccion de fin en el indice:',
      placeholder: 'ej. 6.1.1',
      validate: (value) => {
        if (!value) return 'La seccion de fin es obligatoria';
      }
    });

    if (p.isCancel(endSection)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }
  }

  // 3. Lógica de Diseño Condicional si hay plantilla base
  let inheritStyle = false;

  if (basePptxPath) {
    const inheritConfirm = await p.confirm({
      message: 'Se detecto una plantilla base. ¿Deseas que las nuevas diapositivas hereden su estilo visual? (S/N)',
      active: 'Si',
      inactive: 'No'
    });
    
    if (p.isCancel(inheritConfirm)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }
    
    inheritStyle = inheritConfirm;

    // Preguntar por qué diapositivas a conservar
    keepSlidesInput = await p.text({
      message: '¿Qué diapositivas de tu plantilla base deseas conservar intactas? (Ej. ingresa \'1-3\' para conservar la carátula, equipo y contexto, o \'1,2,4\'):',
      placeholder: '1-3',
      defaultValue: '1-3',
      validate: (value) => {
        if (!value) return 'Debes ingresar al menos una diapositiva';
        if (!/^[\d\s,-]+$/.test(value)) {
          return 'Formato inválido. Ejemplo de formato correcto: 1-3, 5 o 1,2,4';
        }
        const parsed = parseKeepSlides(value);
        if (parsed.length === 0 || parsed.some(n => n <= 0)) {
          return 'Debes ingresar números mayores a 0';
        }
      }
    });
    
    if (p.isCancel(keepSlidesInput)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }
  }

  // SIEMPRE se solicita el Motor de IA
  const aiModel = await p.select({
    message: 'Selecciona el Motor de IA (AI Engine):',
    options: [
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Recomendado) - Rapido y economico. Promedio: ~$0.003 USD por PPTX.' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro - Mayor razonamiento, ideal para logica compleja. Promedio: ~$0.15 USD por PPTX.' }
    ]
  });

  if (p.isCancel(aiModel)) {
    p.cancel('Operacion cancelada por el usuario.');
    throw new Error('CANCELLED');
  }

  // Preguntar por el Tema únicamente si no hay base o si eligió NO heredar estilo
  let theme = 'classic';
  if (!basePptxPath || !inheritStyle) {
    theme = await p.select({
      message: 'Selecciona el Tema de Diseno para el PPTX:',
      options: [
        { value: 'classic', label: 'Clasico Academico: Fondo blanco, texto negro, acentos en azul oscuro.' },
        { value: 'minimalist', label: 'Minimalista SaaS: Diseno en modo oscuro (fondo dark/carbon), texto blanco, con acentos en morado y cian neon.' },
        { value: 'corporate', label: 'Corporativo: Fondo gris claro, texto gris oscuro, acentos en verde esmeralda.' }
      ]
    });

    if (p.isCancel(theme)) {
      p.cancel('Operacion cancelada por el usuario.');
      throw new Error('CANCELLED');
    }
  }

  return {
    isFromCache,
    cacheData,
    basePptxPath,
    repo,
    branch,
    tocPath,
    title,
    course,
    startSection,
    endSection,
    aiModel,
    theme,
    inheritStyle,
    keepSlidesInput
  };
}

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as p from '@clack/prompts';

const TEMP_DIR = './temp_assets';

/**
 * Crea la carpeta temporal para imágenes si no existe
 */
export function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Limpia y elimina la carpeta temporal de imágenes
 */
export function cleanupTempDir() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

/**
 * Determina si una ruta de imagen es remota o local en el repo
 */
export function isRemoteUrl(url) {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
}

/**
 * Ejecuta una función de petición HTTP con reintentos y retroceso exponencial
 */
async function requestWithRetry(requestFn, retries = 4, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await requestFn();
    } catch (error) {
      const isRateLimit = error.response && error.response.status === 429;
      const isLastRetry = i === retries - 1;
      
      if (isRateLimit && !isLastRetry) {
        const backoffDelay = delay * Math.pow(2, i);
        p.log.warn(`[RETRY] Limite de peticiones alcanzado (429). Reintentando en ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Descarga todas las imágenes (locales de GitHub y remotas externas) y las guarda localmente
 * @param {string} repo - Repositorio en formato owner/repo
 * @param {string} branch - Rama git
 * @param {Array} imageObjects - Lista de objetos { original, resolved }
 * @param {string} token - Token de GitHub
 * @returns {Promise<Object>} Un mapa de { rutaOriginal: rutaLocalTemporal }
 */
export async function downloadImages(repo, branch, imageObjects, token) {
  ensureTempDir();
  const pathMap = {};
  
  const client = axios.create({
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'Markdown-to-PPTX-Automator'
    }
  });

  for (let i = 0; i < imageObjects.length; i++) {
    const { original, resolved } = imageObjects[i];
    
    // Obtener la extensión original (por defecto .png)
    let ext = path.extname(resolved.split('?')[0]) || '.png';
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext.toLowerCase())) {
      ext = '.png';
    }
    
    const localFileName = `img_${i}${ext}`;
    const localPath = path.join(TEMP_DIR, localFileName);
    
    try {
      let response;
      if (isRemoteUrl(resolved)) {
        p.log.info(`[INFO] Descargando imagen remota: ${resolved}...`);
        const url = resolved.startsWith('//') ? `https:${resolved}` : resolved;
        response = await requestWithRetry(() => axios.get(url, { responseType: 'arraybuffer' }));
      } else {
        const cleanPath = resolved.replace(/^\.\//, '');
        p.log.info(`[INFO] Descargando imagen de GitHub: ${cleanPath}...`);
        const githubUrl = `https://api.github.com/repos/${repo}/contents/${cleanPath}?ref=${branch}`;
        response = await requestWithRetry(() => client.get(githubUrl, { responseType: 'arraybuffer' }));
      }
      
      fs.writeFileSync(localPath, response.data);
      pathMap[original] = localPath;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        p.log.warn(`[WARN] Imagen no encontrada (404): ${resolved}`);
      } else {
        p.log.warn(`[WARN] Error al descargar imagen "${resolved}": ${error.message}`);
      }
      pathMap[original] = null; // Mapear a null si falla para no romper el flujo
    }
  }
  
  return pathMap;
}

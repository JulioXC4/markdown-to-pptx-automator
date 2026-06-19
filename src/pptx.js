import { spawn } from 'child_process';
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = './temp_assets';

/**
 * Genera el archivo PowerPoint (.pptx) delegando a python-pptx
 * @param {Object} data - Objeto que contiene las diapositivas { slides: [...] }
 * @param {string} presentationTitle - Título de la presentación
 * @param {Object} imageMap - Mapa de { rutaOriginal: rutaLocalTemporal }
 * @param {string} outputPath - Nombre del archivo final a guardar
 * @param {string} basePptxPath - Ruta del archivo PPTX base exportado de Canva
 * @param {string} themeName - Nombre del tema de diseño seleccionado
 * @param {Function} onProgress - Callback para notificar el progreso de procesamiento
 */
export async function generatePresentation(data, presentationTitle, imageMap, outputPath = 'presentacion.pptx', basePptxPath = './plantilla_restock.pptx', themeName = 'classic', inheritStyle = false, keepSlidesInput = '1-3', onProgress) {
  const slidesJsonPath = path.join(TEMP_DIR, 'slides_payload.json');
  const imageMapJsonPath = path.join(TEMP_DIR, 'image_map_payload.json');
  const tempOutputPath = path.join(TEMP_DIR, 'temp_output_presentation.pptx');
  
  // Guardar datos temporales para que Python los consuma
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(slidesJsonPath, JSON.stringify(data, null, 2));
  fs.writeFileSync(imageMapJsonPath, JSON.stringify(imageMap, null, 2));
  
  // Mostrar indicador [FILE]
  if (basePptxPath) {
    console.log(`\n\x1b[36m[FILE]\x1b[0m PPTX base cargado en memoria desde: \x1b[32m${basePptxPath}\x1b[0m`);
  }

  await new Promise((resolve, reject) => {
    // Configurar argumentos para Python
    const args = [
      'src/pptx_editor.py',
      '--base', basePptxPath || './plantilla_restock.pptx',
      '--title', presentationTitle,
      '--slides-json', slidesJsonPath,
      '--image-map-json', imageMapJsonPath,
      '--theme', themeName,
      '--inherit-style', inheritStyle ? 'yes' : 'no',
      '--keep-slides', keepSlidesInput,
      '--output', tempOutputPath
    ];
    
    // Spawneamos el script en Python
    const py = spawn('python', args);
    
    let stderrData = '';
    
    py.stdout.on('data', (data) => {
      const output = data.toString().trim();
      const lines = output.split('\n');
      lines.forEach(line => {
        if (line.startsWith('[EDIT]')) {
          console.log(`\x1b[35m[EDIT]\x1b[0m Título de la carátula actualizado a: \x1b[1m${presentationTitle}\x1b[0m`);
        } else if (line.startsWith('[APPEND]')) {
          const countMatch = line.match(/\d+/);
          const count = countMatch ? countMatch[0] : 'N';
          console.log(`\x1b[34m[APPEND]\x1b[0m Añadiendo \x1b[1m${count}\x1b[0m diapositivas dinámicas al final de la presentación...`);
        } else if (line.startsWith('Canva Template [BASE]')) {
          console.log(`\n\x1b[36mCanva Template [BASE] ---> [EXTRACTING STYLE] ---> Style Engine\x1b[0m`);
        } else if (line.startsWith('User Selection [KEEP]')) {
          console.log(`\x1b[36mUser Selection [KEEP] ---> [CLEANING SLIDES]  ---> Static Slides Ready\x1b[0m`);
        } else if (line.startsWith('AI Expert [Dynamic]')) {
          console.log(`\x1b[36mAI Expert [Dynamic]   ---> [INHERITING STYLE] ---> Final Merge\x1b[0m\n`);
        } else if (line.startsWith('[DNA]')) {
          console.log(`\x1b[33m${line}\x1b[0m`);
        } else if (line.startsWith('[FILE]')) {
          // Ignorar log de guardado interno de python
        } else {
          if (line) console.log(line);
        }
      });
    });
    
    py.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    py.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`El script de Python finalizó con código de error ${code}. Detalle:\n${stderrData}`));
      }
    });
  });

  // Guardar archivo final de forma directa controlando el bloqueo de archivo (EBUSY)
  let success = false;
  let savedName = outputPath;
  
  while (!success) {
    try {
      fs.copyFileSync(tempOutputPath, savedName);
      success = true;
    } catch (err) {
      const isLocked = err.code === 'EBUSY' || err.code === 'EACCES' || err.message.includes('busy or locked');
      if (isLocked) {
        const confirmRetry = await p.text({
          message: `[WARN] El archivo ${savedName} está abierto en otro programa. Ciérralo y presiona ENTER para reintentar el guardado....`,
          placeholder: 'Presiona ENTER para reintentar'
        });
        
        if (p.isCancel(confirmRetry)) {
          throw new Error('CANCELLED');
        }
      } else {
        throw new Error(`No se pudo escribir en el archivo "${savedName}" (puede ser por disco lleno o restricciones de sistema): ${err.message}`);
      }
    }
  }
  
  return savedName;
}

/**
 * Procesa el texto plano y genera una estructura de diapositivas "cruda" en caso de caída del LLM
 */
export function parseRawSlides(content, imageMap) {
  const lines = content.split('\n');
  const slides = [];
  let currentSlide = null;
  
  const headingRegex = /^(#{1,6})\s+(.+)$/;
  
  for (const line of lines) {
    const headingMatch = line.match(headingRegex);
    if (headingMatch) {
      if (currentSlide) {
        slides.push(currentSlide);
      }
      currentSlide = {
        type: 'bullet',
        title: headingMatch[2].trim().substring(0, 45),
        bullets: [],
        associatedImage: null
      };
    } else {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Detectar si la línea contiene una imagen Markdown o HTML
      const mdImgMatch = trimmed.match(/!\[([^\]]*)\]\(([^)#\s?]+)/);
      if (mdImgMatch && currentSlide) {
        const imgPath = mdImgMatch[2].trim();
        // Verificar si la imagen está en el mapa de descargas locales exitosas
        if (imageMap[imgPath]) {
          currentSlide.associatedImage = imgPath;
          currentSlide.type = 'image-focus';
        }
        continue;
      }
      
      const htmlImgMatch = trimmed.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (htmlImgMatch && currentSlide) {
        const imgPath = htmlImgMatch[1].trim();
        if (imageMap[imgPath]) {
          currentSlide.associatedImage = imgPath;
          currentSlide.type = 'image-focus';
        }
        continue;
      }
      
      if (currentSlide) {
        // Limpiar indicadores de listas Markdown (como -, *, +, o números 1., 2.)
        const cleanLine = trimmed.replace(/^([-*+]|\d+\.)\s+/, '');
        if (cleanLine.length > 5) {
          currentSlide.bullets.push(cleanLine.substring(0, 120)); // Limitar longitud
        }
      }
    }
  }
  
  if (currentSlide) {
    slides.push(currentSlide);
  }
  
  // Si no se encontraron encabezados
  if (slides.length === 0) {
    slides.push({
      type: 'bullet',
      title: 'Resumen de Documentacion',
      bullets: [content.substring(0, 400)],
      associatedImage: null
    });
  }
  
  // Procesamiento final para formatear y respetar el tipo de diapositiva
  const processedSlides = [];
  for (const slide of slides) {
    if (slide.bullets.length === 0) {
      slide.bullets.push('Consulte los detalles adicionales en el repositorio.');
    }
    
    if (slide.type === 'image-focus') {
      // Limitar a 1 sola viñeta como leyenda explicativa
      slide.bullets = [slide.bullets[0]];
      processedSlides.push(slide);
    } else {
      // Para diapositivas normales, si exceden las 5 viñetas, se divide en varias diapositivas
      let start = 0;
      let part = 1;
      const totalBullets = slide.bullets;
      
      while (start < totalBullets.length) {
        const chunk = totalBullets.slice(start, start + 5);
        processedSlides.push({
          type: 'bullet',
          title: part > 1 ? `${slide.title} - Parte ${part}` : slide.title,
          bullets: chunk,
          associatedImage: part === 1 ? slide.associatedImage : null
        });
        start += 5;
        part++;
      }
    }
  }
  
  return processedSlides;
}

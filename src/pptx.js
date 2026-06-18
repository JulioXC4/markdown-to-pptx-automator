import pptxgen from 'pptxgenjs';
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';

// Definición de temas de colores premium para la presentación
const THEMES = {
  classic: {
    bgLight: 'FFFFFF',
    bgDark: '0F172A',
    primaryText: '1E293B',
    secondaryText: '475569',
    accent: '1E3A8A',
    accentLight: '93C5FD',
    white: 'FFFFFF',
    border: 'E2E8F0'
  },
  minimalist: {
    bgLight: '121212',
    bgDark: '1E1E1E',
    primaryText: 'E2E8F0',
    secondaryText: '94A3B8',
    accent: 'A855F7',
    accentLight: '22D3EE',
    white: 'FFFFFF',
    border: '334155'
  },
  corporate: {
    bgLight: 'F3F4F6',
    bgDark: '111827',
    primaryText: '1F2937',
    secondaryText: '4B5563',
    accent: '059669',
    accentLight: 'A7F3D0',
    white: 'FFFFFF',
    border: 'D1D5DB'
  }
};

/**
 * Genera el archivo PowerPoint (.pptx) con un diseño visual estructurado y moderno
 * @param {Object} data - Objeto que contiene las diapositivas { slides: [...] }
 * @param {string} presentationTitle - Título de la presentación
 * @param {Object} imageMap - Mapa de { rutaOriginal: rutaLocalTemporal }
 * @param {string} outputPath - Nombre del archivo final a guardar
 * @param {string} themeName - Nombre del tema visual seleccionado
 * @param {Function} onProgress - Callback para notificar el progreso de procesamiento
 */
export async function generatePresentation(data, presentationTitle, imageMap, outputPath = 'presentacion.pptx', themeName = 'classic', onProgress) {
  const pres = new pptxgen();
  
  // Configurar dimensiones a 16:9
  pres.layout = 'LAYOUT_16x9';
  
  const COLORS = THEMES[themeName] || THEMES.classic;
  
  // -------------------------------------------------------------
  // DIAPOSITIVA 1: Portada (Estilo Premium Minimalista Oscuro)
  // -------------------------------------------------------------
  const coverSlide = pres.addSlide();
  coverSlide.background = { fill: COLORS.bgDark };
  
  // Barra de acento lateral
  coverSlide.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.25,
    h: 5.625,
    fill: { color: COLORS.accent }
  });
  
  // Título de la presentación
  coverSlide.addText(presentationTitle, {
    x: 0.8,
    y: 1.8,
    w: 8.5,
    h: 1.6,
    color: COLORS.white,
    fontSize: 36,
    bold: true,
    fontFace: 'Arial',
    valign: 'top'
  });
  
  // Subtítulo
  coverSlide.addText('Documentación Resumida Automáticamente', {
    x: 0.8,
    y: 3.3,
    w: 8.5,
    h: 0.4,
    color: COLORS.accentLight,
    fontSize: 16,
    italic: true,
    fontFace: 'Arial'
  });
  
  // Metadatos / Pie de página
  coverSlide.addText(`Generado con Gemini API • ${new Date().toLocaleDateString()}`, {
    x: 0.8,
    y: 4.8,
    w: 8.5,
    h: 0.3,
    color: COLORS.secondaryText,
    fontSize: 11,
    fontFace: 'Calibri'
  });

  // -------------------------------------------------------------
  // DIAPOSITIVAS DE CONTENIDO (Layouts de 1 o 2 columnas)
  // -------------------------------------------------------------
  data.slides.forEach((slideData, index) => {
    if (onProgress) {
      onProgress(index + 1, data.slides.length);
    }
    const slide = pres.addSlide();
    slide.background = { fill: COLORS.bgLight };
    
    // Título de la diapositiva
    slide.addText(slideData.title, {
      x: 0.6,
      y: 0.4,
      w: 8.8,
      h: 0.6,
      color: COLORS.accent,
      fontSize: 22,
      bold: true,
      fontFace: 'Arial',
      valign: 'middle'
    });
    
    // Pequeño rectángulo de acento debajo del título
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.6,
      y: 0.95,
      w: 1.2,
      h: 0.04,
      fill: { color: COLORS.accent }
    });
    
    // Identificar si la diapositiva tiene una imagen válida asociada
    const originalImgPath = slideData.associatedImage;
    const localImgPath = originalImgPath ? imageMap[originalImgPath] : null;
    const hasImage = !!localImgPath;
    
    if (slideData.type === 'image-focus') {
      // -------------------------------------------------------------
      // LAYOUT ENFOCADO EN IMAGEN (Imagen gigante centrada + Leyenda abajo)
      // -------------------------------------------------------------
      if (hasImage) {
        try {
          slide.addImage({
            path: localImgPath,
            x: 1.0,
            y: 1.2,
            w: 8.0,
            h: 3.4,
            sizing: { type: 'contain', w: 8.0, h: 3.4 }
          });
        } catch (err) {
          p.log.warn(`[WARN] No se pudo renderizar la imagen "${localImgPath}" en la diapositiva: ${err.message}`);
        }
      }
      
      // Mostrar la leyenda descriptiva (la primera viñeta) abajo
      const captionText = slideData.bullets && slideData.bullets.length > 0 ? slideData.bullets[0] : '';
      if (captionText) {
        slide.addText(captionText, {
          x: 1.0,
          y: 4.7,
          w: 8.0,
          h: 0.5,
          color: COLORS.secondaryText,
          fontSize: 13,
          fontFace: 'Calibri',
          italic: true,
          align: 'center',
          valign: 'middle'
        });
      }
      
    } else if (hasImage) {
      // -------------------------------------------------------------
      // LAYOUT DE 2 COLUMNAS (Texto 40% izquierda, Imagen 55% derecha)
      // -------------------------------------------------------------
      
      // Columna de Viñetas (40% del ancho)
      const bulletPoints = slideData.bullets.map((bulletText, bIdx) => ({
        text: bulletText,
        options: {
          bullet: true,
          breakLine: bIdx < slideData.bullets.length - 1,
          color: COLORS.primaryText,
          fontSize: 14,
          fontFace: 'Calibri',
          paraSpaceAfter: 10
        }
      }));
      
      slide.addText(bulletPoints, {
        x: 0.5,
        y: 1.4,
        w: 4.0,
        h: 3.6,
        valign: 'top',
        margin: 0
      });
      
      // Columna de Imagen (55% del ancho, a la derecha)
      try {
        slide.addImage({
          path: localImgPath,
          x: 4.5,
          y: 1.4,
          w: 5.5,
          h: 3.6,
          sizing: { type: 'contain', w: 5.5, h: 3.6 }
        });
      } catch (err) {
        p.log.warn(`[WARN] No se pudo renderizar la imagen "${localImgPath}" en la diapositiva: ${err.message}`);
      }
      
    } else {
      // -------------------------------------------------------------
      // LAYOUT DE 1 COLUMNA (Texto 80% centrado)
      // -------------------------------------------------------------
      const bulletPoints = slideData.bullets.map((bulletText, bIdx) => ({
        text: bulletText,
        options: {
          bullet: true,
          breakLine: bIdx < slideData.bullets.length - 1,
          color: COLORS.primaryText,
          fontSize: 15,
          fontFace: 'Calibri',
          paraSpaceAfter: 12
        }
      }));
      
      slide.addText(bulletPoints, {
        x: 1.0,
        y: 1.4,
        w: 8.0,
        h: 3.6,
        valign: 'top',
        margin: 0
      });
    }
    
    // Numeración de página pequeña en la esquina
    slide.addText(`${index + 1} / ${data.slides.length}`, {
      x: 9.0,
      y: 5.2,
      w: 0.8,
      h: 0.3,
      color: COLORS.secondaryText,
      fontSize: 10,
      align: 'right',
      fontFace: 'Calibri'
    });
  });
  
  let savedName = outputPath;
  // Validar y preparar el directorio de destino
  const destDir = path.dirname(path.resolve(savedName));
  if (!fs.existsSync(destDir)) {
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (err) {
      throw new Error(`No se pudo crear el directorio de destino "${destDir}": ${err.message}`);
    }
  }

  // Validar permisos de escritura en el directorio de destino
  try {
    fs.accessSync(destDir, fs.constants.W_OK);
  } catch (err) {
    throw new Error(`No tienes permisos de escritura en el directorio de destino "${destDir}"`);
  }

  // Guardar archivo final de forma directa controlando el bloqueo de archivo (EBUSY)
  let success = false;
  while (!success) {
    try {
      // Escritura directa al archivo de destino
      await pres.writeFile({ fileName: savedName });
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

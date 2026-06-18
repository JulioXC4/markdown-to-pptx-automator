import * as p from '@clack/prompts';
import fs from 'fs';
import { runCli } from './cli.js';
import { parseIndex, extractRangeContent } from './github.js';
import { downloadImages, cleanupTempDir } from './utils.js';
import { summarizeContent } from './llm.js';
import { generatePresentation, parseRawSlides } from './pptx.js';

const CACHE_FILE = '.cache_payload.json';

async function main() {
  const outputFilename = 'presentacion.pptx';
  const s = p.spinner();
  
  try {
    // 1. Obtener parámetros del usuario vía CLI (maneja la detección de caché)
    const config = await runCli();
    
    const token = process.env.GITHUB_TOKEN;
    const geminiKey = process.env.GEMINI_API_KEY;

    let extraction;
    let imageMap = {};

    if (config.isFromCache) {
      p.log.info('[INFO] Restableciendo estado desde el archivo de cache local...');
      extraction = {
        content: config.cacheData.content,
        images: config.cacheData.images
      };
      imageMap = config.cacheData.imageMap || {};

      // Verificar que las imágenes temporales de la caché existan en disco
      const missingImages = [];
      for (const [original, localPath] of Object.entries(imageMap)) {
        if (localPath && !fs.existsSync(localPath)) {
          const imgObj = extraction.images.find(img => img.original === original);
          if (imgObj) {
            missingImages.push(imgObj);
          }
        }
      }

      if (missingImages.length > 0) {
        s.start('Detectadas imagenes faltantes en cache. Descargando...');
        const newMap = await downloadImages(config.repo, config.branch, missingImages, token);
        imageMap = { ...imageMap, ...newMap };
        s.stop('[OK] Imagenes faltantes descargadas.');

        // Actualizar archivo de caché con el nuevo mapa de imágenes
        config.cacheData.imageMap = imageMap;
        fs.writeFileSync(CACHE_FILE, JSON.stringify(config.cacheData, null, 2));
      }
    } else {
      // Flujo normal: Descargar todo de GitHub
      
      // 2. Descargar y parsear el índice (Tabla de Contenidos)
      s.start('Descargando y analizando la tabla de contenidos desde GitHub...');
      const sections = await parseIndex(config.repo, config.branch, config.tocPath, token);
      s.stop(`[OK] Indice cargado. Se encontraron ${sections.length} secciones.`);

      // 3. Extraer contenido y detectar imágenes del rango
      s.start(`Extrayendo contenido de las secciones [${config.startSection}] a [${config.endSection}]...`);
      extraction = await extractRangeContent(
        config.repo,
        config.branch,
        sections,
        config.startSection,
        config.endSection,
        token
      );
      s.stop(`[OK] Contenido extraido. Largo: ${extraction.content.length} caracteres. Imagenes detectadas: ${extraction.images.length}.`);

      // 4. Descargar imágenes en la carpeta temporal
      if (extraction.images.length > 0) {
        s.start('Descargando imagenes asociadas...');
        imageMap = await downloadImages(config.repo, config.branch, extraction.images, token);
        s.stop('[OK] Imagenes descargadas y mapeadas.');
      } else {
        p.log.info('[INFO] No se encontraron imagenes en las secciones seleccionadas.');
      }

      // Guardar el estado recolectado en la caché local
      const cachePayload = {
        config: {
          repo: config.repo,
          branch: config.branch,
          tocPath: config.tocPath,
          title: config.title,
          startSection: config.startSection,
          endSection: config.endSection
        },
        content: extraction.content,
        images: extraction.images,
        imageMap
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cachePayload, null, 2));
      p.log.info('[INFO] Estado guardado en cache local (.cache_payload.json).');
    }

    // 5. Generar resumen estructurado con Gemini
    let result = null;
    let usedFallback = false;

    s.start('Procesando resumen inteligente y estructuracion de diapositivas con Gemini...');
    try {
      result = await summarizeContent(
        extraction.content,
        extraction.images.map(img => img.original),
        config.title,
        geminiKey
      );
      s.stop(`[OK] Gemini completo el analisis. Se estructuraron ${result.slides.length} diapositivas.`);
    } catch (llmError) {
      s.stop('[WARN] No se pudo procesar el resumen con Gemini o se agotaron los intentos.');
      p.log.warn(`[WARN] Detalle del error: ${llmError.message}`);

      // Preguntar si se desea generar una presentación cruda/de respaldo
      const generateRaw = await p.confirm({
        message: 'La API de IA no responde. ¿Deseas generar una presentacion "cruda" (sin resumir) con el texto e imagenes recolectadas?'
      });

      if (p.isCancel(generateRaw)) {
        p.cancel('Operacion cancelada por el usuario.');
        throw new Error('CANCELLED');
      }

      if (generateRaw) {
        usedFallback = true;
        p.log.info('[INFO] Generando diapositivas crudas a partir del Markdown (modo de respaldo)...');
        const rawSlides = parseRawSlides(extraction.content, imageMap);
        result = {
          slides: rawSlides,
          usage: null
        };
      } else {
        throw new Error('El proceso fue cancelado porque la IA fallo y se rechazo la generacion de respaldo.');
      }
    }

    // 6. Crear el archivo PowerPoint (.pptx)
    s.start('Generando presentacion PowerPoint (.pptx) estilizada localmente...');
    const finalSavedName = await generatePresentation(
      { slides: result.slides },
      config.title,
      imageMap,
      outputFilename,
      (current, total) => {
        s.message(`Procesando diapositiva ${current} de ${total}...`);
      }
    );
    s.stop(`[OK] Presentacion PowerPoint generada.`);

    // 7. Borrar la caché de checkpoint solo en caso de éxito
    if (fs.existsSync(CACHE_FILE)) {
      try {
        fs.unlinkSync(CACHE_FILE);
      } catch (e) {
        // Ignorar fallo al borrar
      }
    }

    // 8. Imprimir reporte de tokens
    if (result.usage) {
      p.log.info('[TOKENS] Consumo de la API de Gemini:');
      p.log.info(`- Tokens de prompt (entrada): ${result.usage.promptTokenCount}`);
      if (result.usage.cachedContentTokenCount) {
        p.log.info(`- Tokens recuperados de cache: ${result.usage.cachedContentTokenCount}`);
      }
      p.log.info(`- Tokens de respuesta (salida): ${result.usage.candidatesTokenCount}`);
      p.log.info(`- Tokens totales: ${result.usage.totalTokenCount}`);
    } else if (usedFallback) {
      p.log.info('[INFO] Presentacion generada en modo de degradacion elegante sin consumo de tokens.');
    }

    // 9. Éxito final
    p.outro(`Proceso completado con exito. La presentacion se guardo como: ${finalSavedName}
Puedes abrir y editar esta presentacion en PowerPoint o importarla en Canva de forma gratuita.`);

  } catch (error) {
    if (error.message === 'CANCELLED') {
      return;
    }
    p.log.error(`[ERROR] Ocurrio un fallo critico: ${error.message}`);
    // Establecer código de salida seguro de Node.js sin llamar a process.exit abruptamente
    process.exitCode = 1;
  } finally {
    // 10. Limpieza general post-ejecución o post-error
    cleanupTempDir();
    
    // Buscar y borrar archivos temporales huerfanos .tmp en la raiz
    try {
      const files = fs.readdirSync('.');
      files.forEach(file => {
        if (file.endsWith('.tmp')) {
          fs.unlinkSync(file);
        }
      });
    } catch (e) {
      // Ignorar errores al limpiar archivos huerfanos
    }
  }
}

main();

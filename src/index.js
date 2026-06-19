import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import { runCli } from './cli.js';
import { parseIndex, extractRangeContent } from './github.js';
import { downloadImages, cleanupTempDir } from './utils.js';
import { summarizeContent } from './llm.js';
import { generatePresentation, parseRawSlides } from './pptx.js';

const CACHE_FILE = '.cache_payload.json';
const TEMP_DIR = './temp_assets';

// Manejador global de cancelación con Ctrl+C (SIGINT)
process.on('SIGINT', () => {
  console.log('\n');
  p.cancel('\x1b[1m\x1b[31mProceso abortado por el usuario.\x1b[0m');
  cleanupTempDir();
  // Limpiar temporales .tmp huérfanos
  try {
    const files = fs.readdirSync('.');
    files.forEach(file => {
      if (file.endsWith('.tmp')) {
        fs.unlinkSync(file);
      }
    });
  } catch (e) {
    // Ignorar errores al limpiar huérfanos
  }
  process.exit(130);
});

async function main() {
  const outputFilename = 'presentacion.pptx';
  const s = p.spinner();
  
  try {
    // 1. Obtener parámetros del usuario vía CLI (maneja la detección de caché y el Setup Wizard)
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
        s.start('Detectadas imagenes faltantes en cache. Sincronizando...');
        const { pathMap: newMap, warnings } = await downloadImages(
          config.repo,
          config.branch,
          missingImages,
          token,
          (curr, tot) => {
            s.message(`Detectadas imagenes faltantes en cache. Sincronizando: [${curr}/${tot}] imagenes...`);
          }
        );
        imageMap = { ...imageMap, ...newMap };
        s.stop('[OK] Imagenes faltantes descargadas.');
        
        if (warnings && warnings.length > 0) {
          warnings.forEach(warn => p.log.warn(`[WARN] ${warn}`));
        }

        // Actualizar archivo de caché con el nuevo mapa de imágenes
        config.cacheData.imageMap = imageMap;
        fs.writeFileSync(CACHE_FILE, JSON.stringify(config.cacheData, null, 2));
      }
    } else {
      // Flujo normal: Descargar todo de GitHub
      
      // Animación de flujo: GitHub -> Local Cache
      console.log('\n\x1b[36mGitHub [Repository]\x1b[0m  ---> \x1b[1m\x1b[32m[EXTRACTING]\x1b[0m ---> \x1b[33mLocal Cache\x1b[0m\n');

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
        s.start(`Sincronizando multimedia: [0/${extraction.images.length}] imagenes procesadas...`);
        const { pathMap: downloadedMap, warnings } = await downloadImages(
          config.repo,
          config.branch,
          extraction.images,
          token,
          (curr, tot) => {
            s.message(`Sincronizando multimedia: [${curr}/${tot}] imagenes procesadas...`);
          }
        );
        imageMap = downloadedMap;
        s.stop(`[OK] Multimedia sincronizada. Procesadas ${extraction.images.length} imagenes.`);
        
        if (warnings && warnings.length > 0) {
          warnings.forEach(warn => p.log.warn(`[WARN] ${warn}`));
        }
      } else {
        p.log.info('[INFO] No se encontraron imagenes en las secciones seleccionadas.');
      }

      // Guardar el estado recolectado en la caché local (incluyendo la selección manual de diapositivas)
      const cachePayload = {
        config: {
          repo: config.repo,
          branch: config.branch,
          tocPath: config.tocPath,
          title: config.title,
          course: config.course,
          basePptxPath: config.basePptxPath,
          inheritStyle: config.inheritStyle,
          keepSlidesInput: config.keepSlidesInput,
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

    // Animación de flujo: Local Cache -> AI Review
    console.log('\n\x1b[33mLocal Cache [Data]\x1b[0m   ---> \x1b[1m\x1b[35m[PROCESSING]\x1b[0m ---> \x1b[36mAI Expert Review\x1b[0m\n');

    // 5. Generar resumen estructurado con Gemini
    let result = null;
    let usedFallback = false;

    s.start(`Procesando resumen inteligente con el motor ${config.aiModel}...`);
    try {
      result = await summarizeContent(
        extraction.content,
        extraction.images.map(img => img.original),
        config.title,
        config.course,
        config.aiModel,
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

    // Animación de flujo: AI Expert -> presentacion.pptx
    console.log('\n\x1b[36mAI Expert [Dynamic]   ---> [INHERITING STYLE] ---> Final Merge\x1b[0m\n');

    // 6. Crear el archivo PowerPoint (.pptx)
    s.start(`Generando presentacion PowerPoint (.pptx)...`);
    const finalSavedName = await generatePresentation(
      { slides: result.slides },
      config.title,
      imageMap,
      outputFilename,
      config.basePptxPath,
      config.theme,
      config.inheritStyle,
      config.keepSlidesInput,
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

    // 8. Imprimir reporte de tokens y costos estimados
    if (result && result.usage) {
      p.log.info('[TOKENS] Consumo de la API de Gemini:');
      p.log.info(`- Tokens de prompt (entrada): ${result.usage.promptTokenCount}`);
      
      const cachedTokens = result.usage.cachedContentTokenCount || 0;
      if (cachedTokens > 0) {
        p.log.info(`- Tokens recuperados de cache: ${cachedTokens}`);
      }
      p.log.info(`- Tokens de respuesta (salida): ${result.usage.candidatesTokenCount}`);
      p.log.info(`- Tokens totales: ${result.usage.totalTokenCount}`);

      // Calcular costos estimativos en USD
      // Tarifas oficiales:
      // Gemini 1.5 Pro: Entrada: $1.25 / 1M, Cache Read: $0.3125 / 1M, Salida: $5.00 / 1M
      // Gemini 1.5 Flash: Entrada: $0.075 / 1M, Cache Read: $0.01875 / 1M, Salida: $0.30 / 1M
      const isPro = config.aiModel === 'gemini-1.5-pro';
      const inputRate = isPro ? 0.00000125 : 0.000000075;
      const cacheRate = isPro ? 0.0000003125 : 0.00000001875;
      const outputRate = isPro ? 0.00000500 : 0.000000300;

      const regularPromptTokens = Math.max(0, result.usage.promptTokenCount - cachedTokens);
      const cost = (regularPromptTokens * inputRate) + (cachedTokens * cacheRate) + (result.usage.candidatesTokenCount * outputRate);

      p.log.info(`- Costo estimado de esta presentacion: ~$${cost.toFixed(6)} USD (Calculado con tarifas de ${isPro ? 'Gemini 1.5 Pro' : 'Gemini 1.5 Flash'})`);
    } else if (usedFallback) {
      p.log.info('[INFO] Presentacion generada en modo de degradacion elegante sin consumo de tokens.');
    }

    // 9. Éxito final
    p.outro(`[SUCCESS] Presentación generada exitosamente. Arrastra ${finalSavedName} a Canva para edición colaborativa en equipo.`);

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

import * as p from '@clack/prompts';
import dotenv from 'dotenv';
import fs from 'fs';

// Cargar variables de entorno
dotenv.config();

const CACHE_FILE = '.cache_payload.json';

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
      return {
        isFromCache: true,
        cacheData: cache,
        ...cache.config
      };
    } else {
      try {
        fs.unlinkSync(CACHE_FILE);
      } catch (e) {
        // Ignorar error al borrar
      }
    }
  }

  const repo = await p.text({
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

  const branch = await p.text({
    message: '2. Rama del repositorio:',
    placeholder: 'main',
    defaultValue: 'main'
  });

  if (p.isCancel(branch)) {
    p.cancel('Operacion cancelada por el usuario.');
    throw new Error('CANCELLED');
  }

  const tocPath = await p.text({
    message: '3. Ruta del archivo indice (Tabla de Contenidos):',
    placeholder: '00-cover.md',
    defaultValue: '00-cover.md'
  });

  if (p.isCancel(tocPath)) {
    p.cancel('Operacion cancelada por el usuario.');
    throw new Error('CANCELLED');
  }

  const title = await p.text({
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

  const course = await p.text({
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

  const startSection = await p.text({
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

  const endSection = await p.text({
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

  return {
    isFromCache: false,
    repo,
    branch,
    tocPath,
    title,
    course,
    startSection,
    endSection
  };
}

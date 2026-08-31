/**
 * Proveedor CAP — descarga documentos CAP 1.2 (Common Alerting Protocol) desde
 * URLs configuradas en CLIMA_CAP_URLS (separadas por coma). CAP es el estándar
 * OASIS/WMO que usan los alertamientos oficiales (SMN/CONAGUA, CENAPRED,
 * agregadores WMO como severeweather.wmo.int).
 *
 * Cada URL debe apuntar a un documento CAP XML (uno o varios <alert>).
 * El parseo es del calculador puro (parsearCap); aquí solo se descarga.
 */

export async function descargarDocumentosCap(urls: string[]): Promise<
  Array<{ url: string; xml?: string; error?: string }>
> {
  const resultados: Array<{ url: string; xml?: string; error?: string }> = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      if (!/<(?:\w+:)?alert[\s>]/i.test(xml)) throw new Error('el documento no contiene <alert> CAP');
      resultados.push({ url, xml });
    } catch (e: any) {
      resultados.push({ url, error: e?.message ?? 'error desconocido' });
    } finally {
      clearTimeout(timer);
    }
  }
  return resultados;
}

/** URLs CAP configuradas (CLIMA_CAP_URLS, separadas por coma). */
export function urlsCapConfiguradas(): string[] {
  return (process.env.CLIMA_CAP_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

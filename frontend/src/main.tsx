// Tras un deploy, los chunks del bundle anterior dejan de existir (hash nuevo).
// Si la app abierta intenta cargar uno, Vite emite este evento: recargamos una
// vez para tomar el bundle vigente en lugar de dejar la pantalla en blanco.
window.addEventListener('vite:preloadError', () => {
  const KEY = 'hydra-reload-preload-error';
  if (sessionStorage.getItem(KEY)) return; // evita bucles si el problema persiste
  sessionStorage.setItem(KEY, '1');
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem('hydra-reload-preload-error'));

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

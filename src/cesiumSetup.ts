// Must be imported before any Cesium module: tells Cesium where its static assets were copied
// (see vite.config.ts → viteStaticCopy).  Relative to the page so it works under any base path.
;(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = new URL('cesium/', document.baseURI).href
import 'cesium/Build/Cesium/Widgets/widgets.css'

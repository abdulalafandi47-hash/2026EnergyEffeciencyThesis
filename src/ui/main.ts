import './styles.css';
import type { ViewerFactory } from '../viewer3d';
import { mountWallEditor } from './app';

/**
 * The 3D library is loaded on demand, after the editor is already usable, so
 * the page appears quickly and the editor works even if 3D never loads.
 */
const viewerFactory: ViewerFactory = async (container, handlers) => {
  const { createWallViewer } = await import('../viewer3d');
  return createWallViewer(container, handlers);
};

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing <div id="app"> in index.html');
}
mountWallEditor(root, undefined, { viewerFactory });

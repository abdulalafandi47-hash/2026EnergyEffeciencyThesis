import './styles.css';
import { mountWallEditor } from './app';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing <div id="app"> in index.html');
}
mountWallEditor(root);

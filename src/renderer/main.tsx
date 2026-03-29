/**
 * 挂载 React 渲染树并启动桌面界面。
 */

import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)

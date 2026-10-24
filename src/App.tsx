import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { jsPDF } from 'jspdf'
import {
  isTauriApp,
  saveTextFile,
  saveTextFileToCurrent,
  saveBytesFile,
  openTextFile,
  readExistingTextFile,
  writeExistingTextFile,
} from './fileService'
import './App.css'
import appIcon from './assets/app-icon.png'



type Tool = 'pen' | 'eraser' | 'pan'
type PaperType = 'a' | 'b' | 'blank' | 'grid'
type NotePage = { id: string; name: string; paper: PaperType | null; image: string | null }
type Category = { id: string; name: string; pages: NotePage[] }
type Notebook = { defaultPaper: PaperType; categories: Category[]; paperSize?: 'a4-portrait' | 'a5-portrait' | 'b5-portrait' | 'a4-landscape' | 'b5-landscape' | 'custom'; customPaperWidth?: number; customPaperHeight?: number }
type RNoteFile = { format: 'TeruNote'; version: 1; exportedAt: string; notebook: Notebook }

const STORAGE_KEY = 'terunote-notebook-v2'
const OLD_STORAGE_KEY = 'terunote-drawing-v1'
const CURRENT_FILE_KEY = 'terunote-current-file-v1'
const paperOptions: { value: PaperType; label: string }[] = [
  { value: 'a', label: 'A罫' }, { value: 'b', label: 'B罫' },
  { value: 'blank', label: '白紙' }, { value: 'grid', label: '方眼紙' },
]
const paperSizeOptions = [
  { value: 'a4-portrait', label: 'A4・縦', width: 7940 / 5, height: 11230 / 5 },
  { value: 'a5-portrait', label: 'A5・縦', width: 5590 / 5, height: 7940 / 5 },
  { value: 'b5-portrait', label: 'B5・縦', width: 6880 / 5, height: 9720 / 5 },
  { value: 'a4-landscape', label: 'A4・横', width: 11230 / 5, height: 7940 / 5 },
  { value: 'b5-landscape', label: 'B5・横', width: 9720 / 5, height: 6880 / 5 },
  { value: 'custom', label: 'カスタム', width: 12000 / 5, height: 16000 / 5 },
] as const

type PaperSizeType = typeof paperSizeOptions[number]['value']
function getNotebookPaperSize(notebook: Notebook) {
  const selected = notebook.paperSize ?? 'a4-portrait'
  if (selected === 'custom') {
    return {
      width: Math.min(10000, Math.max(1, Math.round(notebook.customPaperWidth ?? 1200))),
      height: Math.min(10000, Math.max(1, Math.round(notebook.customPaperHeight ?? 1600))),
    }
  }
  const option = paperSizeOptions.find(item => item.value === selected) ?? paperSizeOptions[0]
  return { width: option.width, height: option.height }
}

function isPaperType(value: unknown): value is PaperType {
  return value === 'a' || value === 'b' || value === 'blank' || value === 'grid'
}
function createId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }
function createPage(number: number): NotePage { return { id: createId(), name: `ページ ${number}`, paper: null, image: null } }
function createNotebook(): Notebook {
  return { defaultPaper: 'a', paperSize: 'a4-portrait', customPaperWidth: 1200, customPaperHeight: 1600, categories: [{ id: createId(), name: 'カテゴリ 1', pages: [createPage(1)] }] }
}
function validateNotebook(value: unknown): value is Notebook {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  if (!isPaperType(data.defaultPaper) || !Array.isArray(data.categories) || !data.categories.length) return false
  if (data.paperSize !== undefined && data.paperSize !== 'a4-portrait' && data.paperSize !== 'a5-portrait' && data.paperSize !== 'b5-portrait' && data.paperSize !== 'a4-landscape' && data.paperSize !== 'b5-landscape' && data.paperSize !== 'custom') return false
  if (data.customPaperWidth !== undefined && (typeof data.customPaperWidth !== 'number' || !Number.isFinite(data.customPaperWidth) || data.customPaperWidth < 1 || data.customPaperWidth > 10000)) return false
  if (data.customPaperHeight !== undefined && (typeof data.customPaperHeight !== 'number' || !Number.isFinite(data.customPaperHeight) || data.customPaperHeight < 1 || data.customPaperHeight > 10000)) return false
  const categoryIds = new Set<string>(), pageIds = new Set<string>()
  for (const category of data.categories) {
    if (!category || typeof category !== 'object') return false
    const c = category as Record<string, unknown>
    if (typeof c.id !== 'string' || !c.id || categoryIds.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.pages) || !c.pages.length) return false
    categoryIds.add(c.id)
    for (const page of c.pages) {
      if (!page || typeof page !== 'object') return false
      const p = page as Record<string, unknown>
      if (typeof p.id !== 'string' || !p.id || pageIds.has(p.id) || typeof p.name !== 'string' || !p.name.trim()) return false
      if (p.paper !== null && !isPaperType(p.paper)) return false
      if (p.image !== null && typeof p.image !== 'string') return false
      pageIds.add(p.id)
    }
  }
  return true
}
function parseRNoteFile(text: string): Notebook {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('ファイル形式が正しくありません')
  const data = parsed as Record<string, unknown>
  if (data.format !== 'TeruNote' || data.version !== 1 || !validateNotebook(data.notebook)) throw new Error('TeruNoteのファイルではありません')
  return data.notebook
}
function createRNoteFile(notebook: Notebook): RNoteFile {
  return { format: 'TeruNote', version: 1, exportedAt: new Date().toISOString(), notebook }
}
function loadNotebook(): Notebook {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (validateNotebook(parsed)) return parsed
    }
    const notebook = createNotebook()
    const oldImage = localStorage.getItem(OLD_STORAGE_KEY)
    if (oldImage) notebook.categories[0].pages[0].image = oldImage
    return notebook
  } catch { return createNotebook() }
}

type PageCanvasProps = {
  page: NotePage
  paper: PaperType
  tool: Tool
  color: string
  size: number
  opacity: number
  paperWidth: number
  paperHeight: number
  zoom: number
  onImageChange: (image: string) => void
  restoreVersion: number
  isPinchingRef: React.MutableRefObject<boolean>
}

// Each page owns its own canvas, so scrolling does not replace another page's drawing.
function PageCanvas({
  page,
  paper,
  tool,
  color,
  size,
  opacity,
  paperWidth,
  paperHeight,
  zoom,
  onImageChange,
  restoreVersion,
  isPinchingRef,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastOwnImageRef = useRef<string | null>(null)
  const lastRestoreVersionRef = useRef(restoreVersion)
  const drawingRef = useRef(false)
  const lastPointRef = useRef({ x: 0, y: 0 })
  const strokePointsRef = useRef<Array<{ x: number; y: number }>>([])
  const strokeBaseRef = useRef<HTMLCanvasElement | null>(null)
  const drawFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let cancelled = false
    let imageToDraw: HTMLImageElement | null = null

    const redraw = () => {
      if (cancelled) return

      const displayWidth = canvas.clientWidth
      const displayHeight = canvas.clientHeight
      if (!displayWidth || !displayHeight) return

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.round(displayWidth * dpr)
      const height = Math.round(displayHeight * dpr)

      const sizeChanged =
        canvas.width !== width || canvas.height !== height

      // Undo・Redoによる復元かどうかを判定
      const isRestore = restoreVersion !== lastRestoreVersionRef.current
      lastRestoreVersionRef.current = restoreVersion

      // 自分で描いた直後は再描画しない
      // Undo・Redoやサイズ変更時は再描画する
      if (
        page.image &&
        page.image === lastOwnImageRef.current &&
        !isRestore &&
        !sizeChanged
      ) {
        return
      }

      if (sizeChanged) {
        canvas.width = width
        canvas.height = height
      }

      // 画像がない場合はキャンバスを消去
      if (!page.image) {
        imageToDraw = null
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        return
      }

      // 画像の読み込み完了後に描画する
      const image = new Image()
      imageToDraw = image

      image.onload = () => {
        if (cancelled || imageToDraw !== image) return

        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
      }

      image.onerror = () => {
        if (cancelled || imageToDraw !== image) return
      }

      image.src = page.image
    }

    const observer = new ResizeObserver(redraw)
    observer.observe(canvas)
    redraw()
    return () => {
      cancelled = true
      imageToDraw = null
      observer.disconnect()
    }
  }, [page.id, page.image, restoreVersion])

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }
  }
  
  
  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan' || isPinchingRef.current) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    event.preventDefault()

    const canvas = event.currentTarget
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.setPointerCapture(event.pointerId)
    drawingRef.current = true

    const p = point(event)
    lastPointRef.current = p
    strokePointsRef.current = [p]

    // 描画開始時のキャンバスを別のキャンバスに一度だけコピー
    const baseCanvas = document.createElement('canvas')
    baseCanvas.width = canvas.width
    baseCanvas.height = canvas.height

    const baseCtx = baseCanvas.getContext('2d')
    if (!baseCtx) {
      drawingRef.current = false
      return
    }

    baseCtx.drawImage(canvas, 0, 0)
    strokeBaseRef.current = baseCanvas

    drawStrokePreview(canvas)
  }

  const drawStrokePreview = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    const base = strokeBaseRef.current
    if (!ctx || !base) return

    // ImageDataの読み書きではなく、キャンバス画像を復元する
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(base, 0, 0)

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.beginPath()
    const points = strokePointsRef.current

    if (points.length === 1) {
      ctx.moveTo(points[0].x, points[0].y)
      ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01)
    } else {
      ctx.moveTo(points[0].x, points[0].y)

      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2
        const midY = (points[i].y + points[i + 1].y) / 2
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY)
      }

      const last = points[points.length - 1]
      ctx.lineTo(last.x, last.y)
    }

    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.globalCompositeOperation =
      tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.globalAlpha = tool === 'eraser' ? 1 : opacity / 100
    ctx.stroke()

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget

    if (isPinchingRef.current) {
      if (drawFrameRef.current !== null) {
        cancelAnimationFrame(drawFrameRef.current)
        drawFrameRef.current = null
      }

      const ctx = canvas.getContext('2d')
      const base = strokeBaseRef.current

      if (drawingRef.current && ctx && base) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(base, 0, 0)
      }

      drawingRef.current = false
      strokeBaseRef.current = null
      strokePointsRef.current = []
      return
    }

    if (tool === 'pan' || !drawingRef.current) return

    const p = point(event)
    lastPointRef.current = p
    strokePointsRef.current.push(p)

    // 1フレームに最大1回だけ描画する
    if (drawFrameRef.current === null) {
      drawFrameRef.current = requestAnimationFrame(() => {
        drawFrameRef.current = null
        if (drawingRef.current && !isPinchingRef.current) {
          drawStrokePreview(canvas)
        }
      })
    }
  }

  const stopDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget

    if (drawFrameRef.current !== null) {
      cancelAnimationFrame(drawFrameRef.current)
      drawFrameRef.current = null
    }

    if (isPinchingRef.current) {
      const ctx = canvas.getContext('2d')
      const base = strokeBaseRef.current

      if (ctx && base) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(base, 0, 0)
      }

      drawingRef.current = false
      strokeBaseRef.current = null
      strokePointsRef.current = []

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (!drawingRef.current) return

    // 最後の点まで描画してから保存
    drawStrokePreview(canvas)
    drawingRef.current = false

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }

    strokeBaseRef.current = null
    onImageChange(canvas.toDataURL('image/png'))
  }


  return (
    <div
      className={`writing-area paper-${paper}`}
      style={{
        width: `${paperWidth}px`,
        height: `${paperHeight}px`,
        aspectRatio: 'auto',
      }}
    >
      <canvas
        ref={canvasRef}
        className={`drawing-canvas ${tool === 'pan' ? 'pan-mode' : ''}`}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
      />
    </div>
  )
}




function paperSizeMm(notebook: Notebook) {
  const px = getNotebookPaperSize(notebook)
  return {
    width: px.width * 25.4 / 96,
    height: px.height * 25.4 / 96
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('ノート画像を読み込めませんでした'))
    image.src = src
  })
}

async function createPageImage(page: NotePage, paper: PaperType, widthPx: number, heightPx: number): Promise<string> {
  const scale = Math.min(2, 6000 / Math.max(widthPx, heightPx))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(widthPx * scale))
  canvas.height = Math.max(1, Math.round(heightPx * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像を作成できませんでした')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(scale, scale)
  ctx.strokeStyle = '#dce8fa'
  ctx.lineWidth = 2
  if (paper === 'grid') {
    for (let x = 100; x < widthPx; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, heightPx); ctx.stroke() }
    for (let y = 100; y < heightPx; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(widthPx, y); ctx.stroke() }
  } else if (paper === 'a' || paper === 'b') {
    const gap = paper === 'a' ? 64 : 50
    for (let y = gap; y < heightPx; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(widthPx, y); ctx.stroke() }
  }
  ctx.restore()
  if (page.image) {
    const image = await loadImage(page.image)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  }
  return canvas.toDataURL('image/jpeg', 0.94)
}

function App() {
  const [notebook, setNotebook] = useState<Notebook>(loadNotebook)
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const writeVersionRef = useRef(0)
  const [activeCategoryId, setActiveCategoryId] = useState(() => notebook.categories[0]?.id ?? '')
  const [activePageId, setActivePageId] = useState(() => notebook.categories[0]?.pages[0]?.id ?? '')
  const [tool, setTool] = useState<Tool>('pen')
  const [zoom, setZoom] = useState(0.5)
  const paperStageRef = useRef<HTMLDivElement>(null)
  const isPinchingRef = useRef(false)

const touchPointersRef = useRef(
  new Map<number, { x: number; y: number }>()
)

const pinchDistanceRef = useRef(0)
  const panDragRef = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const [color, setColor] = useState('#202020')
  const [size, setSize] = useState(3)
  const [opacity, setOpacity] = useState(100)
  const [saveStatus, setSaveStatus] = useState('起動準備中...')
  const [showCategories, setShowCategories] = useState(true)
  const [showPages, setShowPages] = useState(true)
  const [showMainTools, setShowMainTools] = useState(true)
  const [showToolSettings, setShowToolSettings] = useState(true)
  const [undoStack, setUndoStack] = useState<Array<{ pageId: string; image: string }>>([])
  const [redoStack, setRedoStack] = useState<Array<{ pageId: string; image: string }>>([])
  const [restoreVersion, setRestoreVersion] = useState(0)
  const [dragCategoryId, setDragCategoryId] = useState<string | null>(null)
  const [dragPageId, setDragPageId] = useState<string | null>(null)
  const activeCategory = notebook.categories.find(c => c.id === activeCategoryId) ?? notebook.categories[0]
  const activePage = activeCategory?.pages.find(p => p.id === activePageId) ?? activeCategory?.pages[0]
  const paperDimensions = getNotebookPaperSize(notebook)

  useEffect(() => {
    let cancelled = false

    const restoreLastFile = async () => {
      // ブラウザ版ではファイルパスから復元しない
      if (!isTauriApp()) {
        setStorageReady(true)
        return
      }

      const savedPath = localStorage.getItem(CURRENT_FILE_KEY)

      try {
        if (savedPath) {
          const restored = parseRNoteFile(
            await readExistingTextFile(savedPath)
          )

          if (cancelled) return

          setNotebook(restored)
          setActiveCategoryId(restored.categories[0].id)
          setActivePageId(restored.categories[0].pages[0].id)
          setCurrentFilePath(savedPath)
          setSaveStatus('ファイルを復元しました')
        }
      } catch {
        if (!cancelled) {
          setCurrentFilePath(null)
          setSaveStatus('前回のファイルを開けません')
        }
      } finally {
        if (!cancelled) setStorageReady(true)
      }
    }

    void restoreLastFile()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!storageReady) return

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notebook))
    } catch {
      // ブラウザ内の保存容量が不足した場合など
    }

    if (!currentFilePath) {
      setSaveStatus(
        isTauriApp()
          ? '保存先未指定（バックアップ保存済み）'
          : 'ブラウザに自動保存済み'
      )
      return
    }

    const version = ++writeVersionRef.current
    const fileData = JSON.stringify(createRNoteFile(notebook))

    setSaveStatus('保存中...')

    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await writeExistingTextFile(currentFilePath, fileData)

        if (version === writeVersionRef.current) {
          setSaveStatus('保存済み')
        }
      })
      .catch(() => {
        if (version === writeVersionRef.current) {
          setSaveStatus('保存失敗')
        }
      })
  }, [notebook, currentFilePath, storageReady])

  const updatePageImage = (pageId: string, image: string) => {
    const oldImage = notebook.categories.flatMap(category => category.pages).find(page => page.id === pageId)?.image
    if (oldImage !== image) {
      setUndoStack(previous => [...previous, { pageId, image: oldImage ?? '' }].slice(-300))
      setRedoStack([])
    }
    setNotebook(previous => ({
      ...previous, categories: previous.categories.map(category => ({
        ...category, pages: category.pages.map(page => page.id === pageId ? { ...page, image } : page),
      }))
    }))
  }
  const restorePageImage = (pageId: string, image: string) => {
    setNotebook(previous => ({
      ...previous, categories: previous.categories.map(category => ({
        ...category, pages: category.pages.map(page => page.id === pageId ? { ...page, image: image || null } : page),
      }))
    }))
  }
  const undo = () => {
    if (!activePage) return
    const index = [...undoStack].map(entry => entry.pageId).lastIndexOf(activePage.id)
    if (index < 0) return
    const entry = undoStack[index]
    setUndoStack(previous => previous.filter((_, i) => i !== index))
    setRedoStack(previous => [...previous, { pageId: activePage.id, image: activePage.image ?? '' }].slice(-300))
    restorePageImage(activePage.id, entry.image)
    setRestoreVersion(version => version + 1)
  }
  const redo = () => {
    if (!activePage) return
    const index = [...redoStack].map(entry => entry.pageId).lastIndexOf(activePage.id)
    if (index < 0) return
    const entry = redoStack[index]
    setRedoStack(previous => previous.filter((_, i) => i !== index))
    setUndoStack(previous => [...previous, { pageId: activePage.id, image: activePage.image ?? '' }].slice(-300))
    restorePageImage(activePage.id, entry.image)
    setRestoreVersion(version => version + 1)
  }
  const reorderCategories = (fromId: string, toId: string) => {
    if (fromId === toId) return
    setNotebook(previous => { const items = [...previous.categories]; const from = items.findIndex(item => item.id === fromId); const to = items.findIndex(item => item.id === toId); if (from < 0 || to < 0) return previous; const [moved] = items.splice(from, 1); items.splice(to, 0, moved); return { ...previous, categories: items } })
  }
  const reorderPages = (fromId: string, toId: string) => {
    if (!activeCategory || fromId === toId) return
    setNotebook(previous => ({ ...previous, categories: previous.categories.map(category => { if (category.id !== activeCategory.id) return category; const items = [...category.pages]; const from = items.findIndex(item => item.id === fromId); const to = items.findIndex(item => item.id === toId); if (from < 0 || to < 0) return category; const [moved] = items.splice(from, 1); items.splice(to, 0, moved); return { ...category, pages: items } }) }))
  }
  const updateActivePage = (update: Partial<NotePage>) => {
    if (!activePage) return
    setNotebook(previous => ({
      ...previous, categories: previous.categories.map(category => ({
        ...category, pages: category.pages.map(page => page.id === activePage.id ? { ...page, ...update } : page),
      }))
    }))
  }
  const addCategory = () => {
    const name = window.prompt('新しいカテゴリ名を入力してください')
    if (!name?.trim()) return
    const category: Category = { id: createId(), name: name.trim(), pages: [createPage(1)] }
    setNotebook(previous => ({ ...previous, categories: [...previous.categories, category] }))
    setActiveCategoryId(category.id); setActivePageId(category.pages[0].id)
  }
  const renameCategory = () => {
    if (!activeCategory) return
    const name = window.prompt('カテゴリ名を変更', activeCategory.name)
    if (!name?.trim()) return
    setNotebook(previous => ({ ...previous, categories: previous.categories.map(c => c.id === activeCategory.id ? { ...c, name: name.trim() } : c) }))
  }
  const deleteCategory = () => {
    if (!activeCategory || notebook.categories.length <= 1) { window.alert('最後のカテゴリは削除できません'); return }
    if (!window.confirm(`「${activeCategory.name}」を削除しますか？`)) return
    const remaining = notebook.categories.filter(c => c.id !== activeCategory.id)
    setNotebook(previous => ({ ...previous, categories: remaining }))
    setActiveCategoryId(remaining[0].id); setActivePageId(remaining[0].pages[0].id)
  }
  const addPage = () => {
    if (!activeCategory) return
    const page = createPage(activeCategory.pages.length + 1)
    setNotebook(previous => ({ ...previous, categories: previous.categories.map(c => c.id === activeCategory.id ? { ...c, pages: [...c.pages, page] } : c) }))
    setActivePageId(page.id)
  }
  const renamePage = () => {
    if (!activePage) return
    const name = window.prompt('ページ名を変更', activePage.name)
    if (name?.trim()) updateActivePage({ name: name.trim() })
  }
  const deletePage = () => {
    if (!activeCategory || !activePage) return
    if (activeCategory.pages.length <= 1) { window.alert('最後のページは削除できません'); return }
    if (!window.confirm(`「${activePage.name}」を削除しますか？`)) return
    const remaining = activeCategory.pages.filter(p => p.id !== activePage.id)
    setNotebook(previous => ({ ...previous, categories: previous.categories.map(c => c.id === activeCategory.id ? { ...c, pages: remaining } : c) }))
    setActivePageId(remaining[0].id)
  }
  const changeCategory = (category: Category) => {
    setActiveCategoryId(category.id)
    setActivePageId(category.pages[0]?.id ?? '')
  }
  const changePage = (page: NotePage) => setActivePageId(page.id)
  const changeZoomAt = (clientX: number, clientY: number, deltaY: number) => {
    const stage = paperStageRef.current
    if (!stage) return
    setZoom(previousZoom => {
      const nextZoom = Math.min(3, Math.max(0.15, previousZoom * Math.exp(-deltaY * 0.002)))
      if (nextZoom === previousZoom) return previousZoom
      const rect = stage.getBoundingClientRect()
      const anchorX = stage.scrollLeft + clientX - rect.left
      const anchorY = stage.scrollTop + clientY - rect.top
      requestAnimationFrame(() => {
        stage.scrollLeft = (anchorX / previousZoom) * nextZoom - (clientX - rect.left)
        stage.scrollTop = (anchorY / previousZoom) * nextZoom - (clientY - rect.top)
      })
      return nextZoom
    })
  }
  const handlePaperWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    changeZoomAt(event.clientX, event.clientY, event.deltaY)
  }
  const handleStagePointerDownCapture = (
  event: PointerEvent<HTMLDivElement>
) => {
  if (event.pointerType !== 'touch') return

  touchPointersRef.current.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
  })

  if (touchPointersRef.current.size === 2) {
    isPinchingRef.current = true

    const points = [...touchPointersRef.current.values()]
    pinchDistanceRef.current = Math.hypot(
      points[1].x - points[0].x,
      points[1].y - points[0].y
    )
  }
}

const handleStagePointerMoveCapture = (
  event: PointerEvent<HTMLDivElement>
) => {
  if (!touchPointersRef.current.has(event.pointerId)) return

  touchPointersRef.current.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
  })

  if (touchPointersRef.current.size !== 2) return

  const points = [...touchPointersRef.current.values()]
  const distance = Math.hypot(
    points[1].x - points[0].x,
    points[1].y - points[0].y
  )

  const previousDistance = pinchDistanceRef.current
  pinchDistanceRef.current = distance

  if (previousDistance > 0 && distance > 0) {
    const stage = paperStageRef.current
    if (!stage) return

    const centerX = (points[0].x + points[1].x) / 2
    const centerY = (points[0].y + points[1].y) / 2

    changeZoomAt(
      centerX,
      centerY,
      -Math.log(distance / previousDistance) / 0.002
    )
  }
}

const handleStagePointerUpCapture = (
  event: PointerEvent<HTMLDivElement>
) => {
  if (event.pointerType !== 'touch') return

  touchPointersRef.current.delete(event.pointerId)

  if (touchPointersRef.current.size === 0) {
    isPinchingRef.current = false
    pinchDistanceRef.current = 0
  }
}
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (tool !== 'pan' || (event.pointerType === 'mouse' && event.button !== 0)) return
    const stage = paperStageRef.current
    if (!stage) return
    event.preventDefault()
    stage.setPointerCapture(event.pointerId)
    panDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop }
  }
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current
    const stage = paperStageRef.current
    if (!drag || drag.pointerId !== event.pointerId || !stage) return
    event.preventDefault()
    stage.scrollLeft = drag.scrollLeft - (event.clientX - drag.x)
    stage.scrollTop = drag.scrollTop - (event.clientY - drag.y)
  }
  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    if (panDragRef.current?.pointerId !== event.pointerId) return
    panDragRef.current = null
    const stage = paperStageRef.current
    if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
  }

  const exportPdf = async () => {
    try {
      const mode = window.prompt('PDFの出力範囲を選んでください：\n1 = ノート全体\n2 = カテゴリ全体\n3 = 現在のページ', '1')
      if (mode !== '1' && mode !== '2' && mode !== '3') return
      let selectedPages: Array<{ category: Category; page: NotePage }> = []
      if (mode === '1') {
        selectedPages = notebook.categories.flatMap(category => category.pages.map(page => ({ category, page })))
      } else if (mode === '2') {
        const list = notebook.categories.map((category, index) => `${index + 1}: ${category.name}`).join('\n')
        const answer = window.prompt(`出力するカテゴリ番号を入力してください：\n${list}`, String(Math.max(1, notebook.categories.findIndex(c => c.id === activeCategory?.id) + 1)))
        if (!answer) return
        const category = notebook.categories[Number(answer) - 1]
        if (!category) { window.alert('カテゴリ番号が正しくありません'); return }
        selectedPages = category.pages.map(page => ({ category, page }))
      } else {
        if (!activeCategory || !activePage) return
        selectedPages = [{ category: activeCategory, page: activePage }]
      }
      if (!selectedPages.length) { window.alert('出力するページがありません'); return }
      const px = getNotebookPaperSize(notebook)
      const mm = paperSizeMm(notebook)
      const orientation = mm.width > mm.height ? 'landscape' : 'portrait'
      const doc = new jsPDF({ unit: 'mm', format: [mm.width, mm.height], compress: true, orientation })
      for (let index = 0; index < selectedPages.length; index++) {
        const { page } = selectedPages[index]
        if (index > 0) doc.addPage([mm.width, mm.height], orientation)
        const image = await createPageImage(page, page.paper ?? notebook.defaultPaper, px.width, px.height)
        doc.addImage(image, 'JPEG', 0, 0, mm.width, mm.height, undefined, 'FAST')
      }
      const baseName = mode === '2' ? selectedPages[0].category.name : mode === '3' ? selectedPages[0].page.name : 'ノート全体'
      const result = await saveBytesFile(
        new Uint8Array(doc.output('arraybuffer')),
        `TeruNote_${baseName}.pdf`,
        'PDF',
        'pdf',
        'application/pdf',
      )

      if (!result.saved) return

      window.alert(
        `${selectedPages.length}ページをPDFに出力しました。`
      )
    } catch (error) {
      console.error('PDF出力エラー:', error)

      const message =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)

      window.alert(`PDF出力に失敗しました。\n\n${message}`)
    }
  }

  const saveNotebookAs = async () => {
    try {
      const result = await saveTextFile(
        JSON.stringify(createRNoteFile(notebook)),
        'TeruNote.rnote',
        'TeruNote',
        'rnote',
        true,
      )

      if (!result.saved) return

      if (result.path) {
        localStorage.setItem(CURRENT_FILE_KEY, result.path)
        setCurrentFilePath(result.path)
      }

      setSaveStatus('保存済み')
    } catch (error) {
      console.error('保存エラー:', error)
      setSaveStatus('保存失敗')
      window.alert('保存に失敗しました。')
    }
  }
  const saveNotebook = async () => {
    try {
      const content = JSON.stringify(createRNoteFile(notebook))

      if (isTauriApp()) {
        if (!currentFilePath) {
          await saveNotebookAs()
          return
        }

        await writeQueueRef.current.catch(() => undefined)

        await writeExistingTextFile(currentFilePath, content)
        setSaveStatus('保存済み')
        return
      }

      const saved = await saveTextFileToCurrent(content)

      if (!saved) {
        await saveNotebookAs()
        return
      }

      setSaveStatus('保存済み')
    } catch (error) {
      console.error('保存エラー:', error)
      setSaveStatus('保存失敗')
      window.alert('保存に失敗しました。')
    }
  }
  const openNotebook = async () => {
    try {
      const selected = await openTextFile('TeruNote', 'rnote')

      if (!selected) return

      if (!window.confirm(
        '現在開いているノートを、選択したファイルの内容に置き換えますか？'
      )) {
        return
      }

      const imported = parseRNoteFile(selected.text)

      setNotebook(imported)
      setActiveCategoryId(imported.categories[0].id)
      setActivePageId(imported.categories[0].pages[0].id)

      if (selected.path) {
        localStorage.setItem(CURRENT_FILE_KEY, selected.path)
        setCurrentFilePath(selected.path)
        setSaveStatus('読み込み完了')
      } else {
        localStorage.removeItem(CURRENT_FILE_KEY)
        setCurrentFilePath(null)
        setSaveStatus('読み込み完了（ブラウザに保存）')
      }
    } catch (error) {
      console.error('読み込みエラー:', error)
      window.alert(
        '読み込みに失敗しました。TeruNote形式のファイルか確認してください。'
      )
    }
  }


  // キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target

      // 入力欄やテキスト編集中はショートカットを無効にする
      if (
        target instanceof HTMLElement &&
        (
          target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        )
      ) {
        return
      }

      // Ctrl + Z / Ctrl + Y / Ctrl + P
      if (event.ctrlKey && !event.altKey && !event.shiftKey) {
        switch (event.key.toLowerCase()) {
          case 's':
            event.preventDefault()
            void saveNotebook()
            return

          case 'z':
            event.preventDefault()
            undo()
            return

          case 'y':
            event.preventDefault()
            redo()
            return

          case 'p':
            event.preventDefault()
            void exportPdf()
            return
        }
      }

      // Ctrl・Alt・Shift・Metaとの組み合わせでは
      // ツール切り替えを実行しない
      if (
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
      ) {
        return
      }

      // ツール切り替え
      switch (event.key) {
        case '1':
          setTool('pen')
          break
        case '2':
          setTool('eraser')
          break
        case '3':
          setTool('pan')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [undo, redo, exportPdf])


  return <main className="app">
    <header className="topbar">
      <div className="brand">
        <img
          className="brand-icon"
          src={appIcon}
          alt="TeruNote"
        />
        <div><h1>TeruNote</h1><p>学習ノート</p></div>
      </div>
      <div className="header-center">
        <button className={`icon-button ${showCategories ? 'panel-visible' : ''}`} type="button" onClick={() => setShowCategories(value => !value)} title="カテゴリ欄の表示切替">☰ <span>カテゴリ</span></button>
        <button className={`icon-button ${showPages ? 'panel-visible' : ''}`} type="button" onClick={() => setShowPages(value => !value)} title="ページ欄の表示切替">▤ <span>ページ</span></button>
        <button className={`icon-button ${showMainTools ? 'panel-visible' : ''}`} type="button" onClick={() => setShowMainTools(value => !value)} title="上部ツール・ページ設定の表示切替">⌃ <span>上部設定</span></button>
        <button className={`icon-button ${showToolSettings ? 'panel-visible' : ''}`} type="button" onClick={() => setShowToolSettings(value => !value)} title="下部ツール設定の表示切替">⌄ <span>下部設定</span></button>
      </div>
      <div className="header-actions">
        <div className="save-status"><span className="status-dot" />{saveStatus}</div>
        <button type="button" className="file-button" title="ショートカット：Ctrl + P" onClick={() => void exportPdf()}>PDF出力</button>
        <button
          type="button"
          className="file-button"
          title='ショートカット：Ctrl + S'
          onClick={() => void saveNotebook()}
        >
          保存
        </button>

        <button
          type="button"
          className="file-button"
          onClick={() => void saveNotebookAs()}
        >
          名前を付けて保存
        </button>
        <button type="button" className="file-button" onClick={() => void openNotebook()}>読み込み</button>
      </div>
    </header>

    <section className="control-window">
      <div className="control-window-heading">
        <strong>ツール・ページ設定</strong>
        <div className="control-heading-actions">
          <button className="history-button" type="button" onClick={undo} disabled={!activePage || !undoStack.some(entry => entry.pageId === activePage.id)} title="元に戻す（Ctrl + Z）" aria-label="元に戻す">↶</button>
          <button className="history-button" type="button" onClick={redo} disabled={!activePage || !redoStack.some(entry => entry.pageId === activePage.id)} title="やり直す（Ctrl + Y）" aria-label="やり直す">↷</button>
        </div>
      </div>
      {showMainTools && <div className="control-window-body">
        <div className="control-row tool-strip">
          <div className="tool-group"><span className="group-label">ツール</span>
            <button className={tool === 'pen' ? 'tool active' : 'tool'} onClick={() => setTool('pen')} type="button" title="ショートカット：1">✎ ペン</button>
            <button className={tool === 'eraser' ? 'tool active' : 'tool'} onClick={() => setTool('eraser')} type="button" title="ショートカット：2">▱ 消しゴム</button>
            <button className={tool === 'pan' ? 'tool active' : 'tool'} onClick={() => setTool('pan')} type="button" title="ショートカット：3">✋ 移動</button>
            <button className="tool" type="button" disabled title="今後追加予定">T テキスト</button>
            <button className="tool" type="button" disabled title="今後追加予定">／ 定規</button>
            <button className="tool" type="button" disabled title="今後追加予定">□ 図形</button>
          </div>
        </div>
        <div className="control-row page-setting-row">
          <label className="paper-select-label">用紙<select value={activePage?.paper ?? 'default'} onChange={event => updateActivePage({ paper: event.target.value === 'default' ? null : event.target.value as PaperType })}><option value="default">デフォルト</option>{paperOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      </div>}
    </section>

    <div className="editor-layout">
      {showCategories && <aside className="sidebar category-sidebar">
        <div className="sidebar-heading"><div><span className="eyebrow">NOTEBOOK</span><h2>カテゴリ</h2></div><button className="round-button" type="button" onClick={addCategory} title="カテゴリ追加">＋</button></div>
        <div className="sidebar-actions">
          <button type="button" onClick={renameCategory}>名前変更</button>
          <button type="button" onClick={deleteCategory}>削除</button>
        </div>
        <div className="category-list" onPointerUp={() => setDragCategoryId(null)} onPointerCancel={() => setDragCategoryId(null)}>
          {notebook.categories.map(category => <button key={category.id} data-category-id={category.id} type="button" onPointerDown={() => setDragCategoryId(category.id)} onPointerEnter={() => { if (dragCategoryId && dragCategoryId !== category.id) reorderCategories(dragCategoryId, category.id) }} onPointerUp={() => setDragCategoryId(null)} className={`${category.id === activeCategory?.id ? 'category-button selected' : 'category-button'} ${dragCategoryId === category.id ? 'dragging' : ''}`} onClick={() => changeCategory(category)}>
            <span className="category-symbol">▤</span><span className="category-name">{category.name}</span><span className="item-count">{category.pages.length}</span>
          </button>)}
        </div>
        <div className="sidebar-bottom">
          <div className="notebook-paper-size-setting">
            <label>用紙サイズ
              <select value={notebook.paperSize ?? 'a4-portrait'} onChange={event => setNotebook(previous => ({ ...previous, paperSize: event.target.value as PaperSizeType }))}>
                {paperSizeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {(notebook.paperSize ?? 'a4-portrait') === 'custom' && <div className="notebook-custom-size-inputs">
              <label>幅 <input type="number" min="1" max="10000" step="1" value={notebook.customPaperWidth ?? 1200} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 10000) setNotebook(previous => ({ ...previous, customPaperWidth: value })) }} /> px</label>
              <label>高さ <input type="number" min="1" max="10000" step="1" value={notebook.customPaperHeight ?? 1600} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 10000) setNotebook(previous => ({ ...previous, customPaperHeight: value })) }} /> px</label>
            </div>}
          </div>
          <label>デフォルト用紙<select value={notebook.defaultPaper} onChange={event => setNotebook(previous => ({ ...previous, defaultPaper: event.target.value as PaperType }))}>{paperOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      </aside>}

      <section className="workspace">
        <div
          className={`paper-stage ${tool === 'pan' ? 'pan-tool-active' : ''}`}
          ref={paperStageRef}
          onWheel={handlePaperWheel}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
          onPointerDownCapture={handleStagePointerDownCapture}
onPointerMoveCapture={handleStagePointerMoveCapture}
onPointerUpCapture={handleStagePointerUpCapture}
        >
          {activePage ? <div className="paper-zoom-wrapper" style={{ width: `${(paperDimensions.width + 2) * zoom}px`, height: `${(paperDimensions.height + 40) * zoom}px` }}>
            <article className="paper active-paper" style={{ width: `${paperDimensions.width}px`, maxWidth: 'none', marginInline: 'auto', transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
              <PageCanvas
                key={activePage.id}
                page={activePage}
                paper={activePage.paper ?? notebook.defaultPaper}
                tool={tool}
                color={color}
                size={size}
                opacity={opacity}
                paperWidth={paperDimensions.width}
                paperHeight={paperDimensions.height}
                zoom={zoom}
                restoreVersion={restoreVersion}
                onImageChange={image => updatePageImage(activePage.id, image)}
                isPinchingRef={isPinchingRef}
              />
            </article>
          </div> : <div className="empty-state">ページがありません</div>}
        </div>
        <footer className={`settings-window ${showToolSettings ? '' : 'collapsed'}`}>
          <div className="settings-window-heading"><div className="settings-title"><span className="settings-dot" />{tool === 'pen' ? 'ツールの設定：ペン' : tool === 'eraser' ? 'ツールの設定：消しゴム' : 'ツール：移動'}</div></div>
          {showToolSettings && <div className="settings-bar">
            <label className="setting color-setting"><span>色</span><input aria-label="ペンの色" type="color" value={color} onChange={event => setColor(event.target.value)} disabled={tool !== 'pen'} /></label>
            <label className="setting size-setting"><span>太さ <b>{size}px</b></span><input aria-label="ペンの太さ" type="range" min="1" max="100" value={size} onChange={event => setSize(Number(event.target.value))} disabled={tool === 'pan'} /></label>
            <label className="setting size-setting opacity-setting"><span>不透明度 <b>{opacity}%</b></span><input aria-label="ペンの不透明度" type="range" min="0" max="100" step="1" value={opacity} onChange={event => setOpacity(Number(event.target.value))} disabled={tool !== 'pen'} /></label>
            <span className="settings-hint">変更は自動保存されます</span>
          </div>}
        </footer>
      </section>

      {showPages && <aside className="sidebar pages-sidebar">
        <div className="sidebar-heading"><div><span className="eyebrow">PAGES</span><h2>ページ一覧</h2></div><button className="round-button" type="button" onClick={addPage} title="ページ追加">＋</button></div>
        <div className="page-sidebar-actions"><button type="button" onClick={renamePage}>名前変更</button><button type="button" onClick={deletePage}>削除</button></div>
        <div className="page-list-scroll" onPointerUp={() => setDragPageId(null)} onPointerCancel={() => setDragPageId(null)}>
          {activeCategory?.pages.map((page, index) => <button key={page.id} data-page-id={page.id} type="button" onPointerDown={() => setDragPageId(page.id)} onPointerEnter={() => { if (dragPageId && dragPageId !== page.id) reorderPages(dragPageId, page.id) }} onPointerUp={() => setDragPageId(null)} className={`${page.id === activePage?.id ? 'page-preview selected' : 'page-preview'} ${dragPageId === page.id ? 'dragging' : ''}`} onClick={() => changePage(page)}>
            <span className="preview-number">{String(index + 1).padStart(2, '0')}</span>
            <span
              className="preview-paper"
              style={{
                aspectRatio: `${paperDimensions.width} / ${paperDimensions.height}`,
              }}
            >
              <span className={`preview-paper-background paper-${page.paper ?? notebook.defaultPaper}`} />
              {page.image && (
                <img src={page.image} alt="" draggable={false} />
              )}
            </span>
            <span className="preview-caption"><strong>{page.name}</strong><small>{paperOptions.find(option => option.value === (page.paper ?? notebook.defaultPaper))?.label}</small></span>
            {page.id === activePage?.id && <span className="selected-check">✓</span>}
          </button>)}
        </div>
        <div className="sidebar-bottom page-count">{activeCategory?.pages.length ?? 0} ページ</div>
      </aside>}
    </div>

    <footer className="app-footer">
      <span>TeruNote</span>
      <span>
        {currentFilePath
          ? `自動保存先：${currentFilePath}`
          : isTauriApp()
            ? '保存先未指定 · バックアップはこのPC内に保存されます'
            : 'ブラウザ内に自動保存 · .rnote形式でバックアップ可能'}
      </span>
    </footer>
  </main>
}

export default App

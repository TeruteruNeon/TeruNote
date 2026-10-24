
type SaveResult = {
  saved: boolean
  path: string | null
}

type OpenResult = {
  text: string
  path: string | null
} | null

type BrowserFileHandle = {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>
    close: () => Promise<void>
  }>
}

type SavePickerOptions = {
  suggestedName?: string
  types?: {
    description: string
    accept: Record<string, string[]>
  }[]
}

let browserSaveHandle: BrowserFileHandle | null = null

export function isTauriApp(): boolean {
  return typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in window
}



function downloadFile(
  data: string | Uint8Array,
  fileName: string,
  mimeType: string,
) {
  let blob: Blob

  if (typeof data === 'string') {
    // JSONなどのテキストファイル
    blob = new Blob([data], { type: mimeType })
  } else {
    // PDFなどのバイナリファイル
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)

    blob = new Blob([buffer], { type: mimeType })
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}


export async function saveTextFile(
  content: string,
  defaultName: string,
  filterName: string,
  extension: string,
  saveAs = false,
): Promise<SaveResult> {
  // Windowsアプリ版
  if (isTauriApp()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')

    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: [extension] }],
    })

    if (!path) return { saved: false, path: null }

    await writeTextFile(path, content)
    return { saved: true, path }
  }

  const pickerWindow = window as Window & {
    showSaveFilePicker?: (
      options?: SavePickerOptions,
    ) => Promise<BrowserFileHandle>
  }

  // 「名前を付けて保存」または初回保存なら保存先を選択
  if (saveAs || !browserSaveHandle) {
    if (pickerWindow.showSaveFilePicker) {
      let selectedHandle: BrowserFileHandle

      try {
        selectedHandle = await pickerWindow.showSaveFilePicker({
          suggestedName: defaultName,
          types: [
            {
              description: filterName,
              accept: {
                'application/json': [`.${extension}`],
              },
            },
          ],
        })
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === 'AbortError'
        ) {
          return { saved: false, path: null }
        }

        throw error
      }

      // 新しいファイルへの書き込みが成功してから保存先を切り替える
      const writable = await selectedHandle.createWritable()
      await writable.write(content)
      await writable.close()

      browserSaveHandle = selectedHandle

      return { saved: true, path: null }
    }

    // 非対応ブラウザではダウンロード
    downloadFile(
      content,
      defaultName,
      'application/json;charset=utf-8',
    )

    return { saved: true, path: null }
  }

  // 通常の保存：前回選んだファイルに上書き
  const writable = await browserSaveHandle.createWritable()
  await writable.write(content)
  await writable.close()

  return { saved: true, path: null }
}
export async function saveTextFileToCurrent(
  content: string,
): Promise<boolean> {
  if (!browserSaveHandle) return false

  const writable = await browserSaveHandle.createWritable()
  await writable.write(content)
  await writable.close()

  return true
}

export async function saveBytesFile(
  content: Uint8Array,
  defaultName: string,
  filterName: string,
  extension: string,
  mimeType: string,
): Promise<SaveResult> {
  if (isTauriApp()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')

    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: [extension] }],
    })

    if (!path) return { saved: false, path: null }

    await writeFile(path, content)
    return { saved: true, path }
  }

  downloadFile(content, defaultName, mimeType)
  return { saved: true, path: null }
}


export async function openTextFile(
  filterName: string,
  extension: string,
): Promise<OpenResult> {
  // Windowsアプリ版
  if (isTauriApp()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')

    const selected = await open({
      multiple: false,
      filters: [{ name: filterName, extensions: [extension] }],
    })

    if (typeof selected !== 'string') return null

    return {
      text: await readTextFile(selected),
      path: selected,
    }
  }

  // Web版：ブラウザのファイル選択機能を使う
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.${extension}`

    let finished = false

    const cleanup = () => {
      input.removeEventListener('change', onChange)
      input.removeEventListener('cancel', onCancel)
      input.remove()
    }

    const finish = (result: OpenResult) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(result)
    }

    const onCancel = () => {
      finish(null)
    }

    const onChange = async () => {
      const file = input.files?.[0]

      if (!file) {
        finish(null)
        return
      }

      try {
        const text = await file.text()
        finish({ text, path: null })
      } catch (error) {
        if (finished) return
        finished = true
        cleanup()
        reject(error)
      }
    }

    input.addEventListener('change', onChange)
    input.addEventListener('cancel', onCancel)

    document.body.appendChild(input)
    input.click()
  })
}


export async function writeExistingTextFile(
  path: string,
  content: string,
): Promise<void> {
  if (!isTauriApp()) {
    throw new Error('ブラウザでは既存ファイルのパスへ直接保存できません')
  }

  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, content)
}

export async function readExistingTextFile(
  path: string,
): Promise<string> {
  if (!isTauriApp()) {
    throw new Error('ブラウザではファイルパスから直接読み込めません')
  }

  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return await readTextFile(path)
}

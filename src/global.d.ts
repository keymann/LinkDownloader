// Vite define 로 주입되는 빌드(배포) 시각
declare const __BUILD_TIME__: string

// File System Access API (Chromium 계열) — 저장 경로 선택용
interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}
interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}
interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>
}
interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}

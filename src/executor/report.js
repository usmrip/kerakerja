const DEFAULT_MAX_SUMMARY_LENGTH = 1500;
const DEFAULT_MAX_LINES = 25;

/**
 * Menghapus kode escape ANSI (warna/kontrol terminal) dari teks.
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  return String(text || '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Membersihkan sintaks Markdown mentah agar rapi dibaca di Telegram & log teks.
 * - Link file:/// lokal diubah menjadi labelnya saja.
 * - Link http(s) diubah menjadi "label (url)" jika label berbeda dari URL.
 * - Penanda bold (**text** / __text__), inline code (`code`), dan heading (#) dirapikan.
 * @param {string} text
 * @returns {string}
 */
function cleanMarkdownForReport(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\((file:\/\/\/[^)]+)\)/gi, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, (_, label, url) => (
      label.trim() === url.trim() ? url : `${label} (${url})`
    ))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
}

/**
 * Membangun prompt eksekusi tugas untuk CLI AI Agent agar menghasilkan
 * laporan akhir yang terstruktur dan menjelaskan detail pekerjaan sesuai perintah.
 * @param {object} task
 * @param {string} instruction
 * @returns {string}
 */
function buildTaskPrompt(task, instruction) {
  const taskId = (task && task.id) ? task.id : 'CLI';
  const cleanInstr = String(instruction || '').trim();
  return [
    `Tugas #${taskId}: ${cleanInstr}.`,
    '',
    'Selesaikan dengan baik sesuai standar proyek. Pada akhir jawaban, tuliskan laporan hasil pekerjaan yang jelas dan terstruktur dalam Bahasa Indonesia (teks biasa tanpa link markdown file:///) dengan format:',
    'Ringkasan Hasil:',
    '- Detail pekerjaan/perubahan yang dilakukan sesuai perintah',
    '- File atau komponen utama yang diubah/dibuat',
    '- Hasil pengujian atau verifikasi yang dijalankan'
  ].join('\n');
}

/**
 * Memotong teks secara rapi pada batas baris atau kata sebelum melebihi maxLength.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateCleanly(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  const limit = Math.max(20, maxLength - 3);
  const slice = text.slice(0, limit);
  const lastNewline = slice.lastIndexOf('\n');
  if (lastNewline > limit * 0.5) {
    return `${slice.slice(0, lastNewline).trimEnd()}...`;
  }
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > limit * 0.5) {
    return `${slice.slice(0, lastSpace).trimEnd()}...`;
  }
  return `${slice.trimEnd()}...`;
}

/**
 * Mengekstrak ringkasan laporan hasil pekerjaan yang informatif dari output CLI agent.
 * Mempertahankan struktur baris/poin (tidak diratakan menjadi satu baris) dan
 * memprioritaskan bagian laporan akhir jika tersedia.
 * @param {string} stdout
 * @param {string} [stderr='']
 * @param {number} [code=0]
 * @param {object} [options={}]
 * @returns {string}
 */
function extractTaskSummary(stdout, stderr = '', code = 0, options = {}) {
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : DEFAULT_MAX_SUMMARY_LENGTH;
  const maxLines = Number.isFinite(options.maxLines) ? options.maxLines : DEFAULT_MAX_LINES;

  const normalize = (raw) => cleanMarkdownForReport(stripAnsi(raw))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let source = normalize(stdout);
  if (!source && code !== 0) {
    source = normalize(stderr);
  }
  if (!source) {
    return code === 0
      ? `Selesai dengan exit code ${code}`
      : `Gagal dengan exit code ${code}`;
  }

  const markerRegex = /(?:^|\n)[ \t]*(?:📋[ \t]*)?(?:Ringkasan Hasil|Hasil Pekerjaan|Laporan Pekerjaan|Laporan Akhir|Kesimpulan|Summary)[ \t]*:/gi;
  let lastMatchIndex = -1;
  let match;
  while ((match = markerRegex.exec(source)) !== null) {
    lastMatchIndex = match.index === 0 ? 0 : match.index + 1;
  }

  let selected = lastMatchIndex >= 0 ? source.slice(lastMatchIndex).trim() : source;
  const lines = selected
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));

  const tailLines = lines.length > maxLines ? lines.slice(-maxLines) : lines;
  const formatted = tailLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return truncateCleanly(formatted, maxLength);
}

module.exports = {
  DEFAULT_MAX_SUMMARY_LENGTH,
  DEFAULT_MAX_LINES,
  stripAnsi,
  cleanMarkdownForReport,
  buildTaskPrompt,
  extractTaskSummary
};

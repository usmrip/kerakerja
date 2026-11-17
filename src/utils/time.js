/**
 * Formats a Date (defaults to now) as `YYYY-MM-DD HH:mm:ss` in the workstation's local timezone.
 * @param {Date|string|number} [date=new Date()]
 * @returns {string}
 */
function formatLocalTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = {
  formatLocalTimestamp
};

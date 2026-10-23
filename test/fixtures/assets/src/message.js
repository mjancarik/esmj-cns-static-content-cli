export function formatMessage(data) {
  return `${data.title}: ${data.items.join(', ')}`;
}
export default function AnaMark({ style, className = '' }) {
  return <img
    src="/ana-logo.svg"
    alt="Ana"
    className={className}
    style={{ display: 'block', objectFit: 'contain', ...style }}
  />
}

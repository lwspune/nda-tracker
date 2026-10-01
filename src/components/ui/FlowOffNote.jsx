import { flowOffMessage } from '../../lib/whatsappFlows'

// The visible line beside a send button whose WhatsApp flow is switched off in
// Settings → WhatsApp. The button is disabled, never hidden, so faculty can see
// the feature still exists; this says why it will not click. A `title` alone is
// not enough: some browsers show no tooltip on a disabled button.
export default function FlowOffNote({ flow, className = '' }) {
  return (
    <span className={`text-[12px] text-ink-2 ${className}`}>
      {flowOffMessage(flow)}
    </span>
  )
}

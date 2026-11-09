import { parseCodeInput, CODE_LENGTH } from "../utils/usernameSignup";
import "../styles/username-signup.css";

// One real <input> for the six-digit code, so browsers and phones can autofill
// it from an SMS or email (autoComplete="one-time-code") and screen readers see
// a single labelled field. Whatever is typed or pasted is reduced to digits:
// "123 456" and "123-456" both become 123456.
export default function CodeInput({ id, value, onChange, onComplete, label, describedBy, invalid, disabled, autoFocus }) {
  const handleChange = (event) => {
    const next = parseCodeInput(event.target.value);
    onChange(next);
    if (next.length === CODE_LENGTH && onComplete) onComplete(next);
  };

  const handlePaste = (event) => {
    const pasted = parseCodeInput(event.clipboardData?.getData("text"));
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    if (pasted.length === CODE_LENGTH && onComplete) onComplete(pasted);
  };

  return (
    <input
      id={id}
      className="codeinput"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      maxLength={CODE_LENGTH + 4}
      placeholder="••••••"
      value={value}
      onChange={handleChange}
      onPaste={handlePaste}
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid ? "true" : undefined}
    />
  );
}

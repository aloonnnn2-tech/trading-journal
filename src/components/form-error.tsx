// One error treatment, announced to screen readers.
//
// **The accessibility half.** Before this, `role="alert"` and `aria-live`
// appeared exactly zero times in the codebase: every failure message in the
// app was visible text and nothing more. Someone using a screen reader
// submitted a form, heard nothing, and had no way to know the submit had
// failed -- the message was on screen, but nothing told them to go and read
// it. `role="alert"` carries an implicit `aria-live="assertive"`, so the text
// is announced the moment it appears, which is the behaviour an error after a
// deliberate action wants.
//
// **The consistency half.** The app had drifted to two colours (`text-loss`
// and `text-red-400`) across otherwise identical messages. This settles on
// `text-loss`, the semantic token the rest of the app uses for a negative.
//
// Size stays a prop rather than a constant because it genuinely varies by
// context: a form under a submit button wants `sm`, a message inside a dense
// side panel wants `xs`. Forcing one size everywhere would make half the call
// sites look wrong, which is how a shared component ends up bypassed.

interface FormErrorProps {
  /** Rendered only when this is truthy, so call sites need no `&&` guard. */
  children?: React.ReactNode;
  size?: "xs" | "sm";
  className?: string;
}

export function FormError({ children, size = "sm", className = "" }: FormErrorProps) {
  if (!children) return null;

  return (
    <p
      role="alert"
      className={`${size === "xs" ? "text-xs" : "text-sm"} text-loss ${className}`.trim()}
    >
      {children}
    </p>
  );
}

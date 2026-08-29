/** Error text sits directly under its own field, never a tooltip. */
export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-4 text-[14px] leading-[20px] text-bad">
      {message}
    </p>
  );
}

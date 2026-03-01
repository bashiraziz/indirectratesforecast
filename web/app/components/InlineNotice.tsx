export function InlineNotice({
  msg,
}: {
  msg: { type: "success" | "error"; text: string } | null;
}) {
  if (!msg) return null;
  return (
    <div
      style={{
        marginTop: 8,
        padding: "6px 10px",
        borderRadius: 6,
        fontSize: 12,
        backgroundColor:
          msg.type === "success"
            ? "var(--color-success-bg, #e6f9e6)"
            : "var(--color-error-bg, #fde8e8)",
        color:
          msg.type === "success"
            ? "var(--color-success, #166534)"
            : "var(--color-error, #991b1b)",
        border: `1px solid ${
          msg.type === "success"
            ? "var(--color-success-border, #bbf7d0)"
            : "var(--color-error-border, #fecaca)"
        }`,
      }}
    >
      {msg.text}
    </div>
  );
}

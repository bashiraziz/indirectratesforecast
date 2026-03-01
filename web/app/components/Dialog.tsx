"use client";

import { X } from "lucide-react";

export function Dialog({
  open,
  onClose,
  title,
  children,
  size = "md",
  scrollable = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  scrollable?: boolean;
}) {
  if (!open) return null;
  const maxW = size === "lg" ? "max-w-lg" : size === "sm" ? "max-w-sm" : "max-w-md";
  const scrollCls = scrollable ? "max-h-[90vh] overflow-y-auto" : "";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={`bg-sidebar border border-border rounded-lg p-5 w-full ${maxW} mx-4 ${scrollCls}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold m-0">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent bg-transparent! border-none!"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} size="sm">
      <p className="text-sm text-muted-foreground mb-4">{message}</p>
      <div className="flex gap-2 justify-end">
        <button className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          Delete
        </button>
      </div>
    </Dialog>
  );
}

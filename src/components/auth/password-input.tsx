"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

// A password box with a show/hide eye, for sign-in, sign-up and reset.
//
// The eye is a real button (type="button", so it never submits the form),
// reachable by keyboard and announced as "Show password" / "Hide password".
// The input keeps its own autocomplete so password managers still fill it.

export function PasswordInput({
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative flex">
      <input
        {...props}
        type={visible ? "text" : "password"}
        // Room for the eye, so a long password never runs under it.
        className={`${className} w-full pr-10`}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-zinc-500 hover:text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:hover:text-zinc-200"
      >
        {visible ? <EyeOff className="h-4 w-4" strokeWidth={2} /> : <Eye className="h-4 w-4" strokeWidth={2} />}
      </button>
    </span>
  );
}

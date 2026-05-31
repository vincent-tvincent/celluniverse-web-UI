import type { PointerEvent as ReactPointerEvent } from "react";

type PanelResizerProps = {
  side: "left" | "right";
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyboardResize: (delta: number) => void;
};

export default function PanelResizer({ side, onPointerDown, onKeyboardResize }: PanelResizerProps) {
  return (
    <div
      className={`panel-resizer ${side}-resizer`}
      role="separator"
      aria-label={`Resize ${side} panel`}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onKeyboardResize(-18);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onKeyboardResize(18);
        }
      }}
    >
      <span />
    </div>
  );
}

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Smile } from "lucide-react";
import { PageIcon } from "../PageIcon";
import { IconPicker } from "./PageHeader";

/** A callout: a box with an icon (an emoji or one of the library, changed by clicking it) and blocks inside. */
export function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const [picking, setPicking] = useState(false);
  const icon = (node.attrs.icon as string | null) || null;
  return (
    <NodeViewWrapper data-type="callout" className="callout">
      <button
        type="button"
        className="callout-icon"
        data-empty={icon ? undefined : ""}
        contentEditable={false}
        aria-label="Cambiar el icono"
        title="Cambiar el icono"
        onClick={() => setPicking((p) => !p)}
      >
        {icon ? <PageIcon icon={icon} size={20} /> : <Smile size={18} aria-hidden="true" />}
      </button>
      <NodeViewContent className="callout-body" />
      {picking && (
        <IconPicker
          current={icon}
          onPick={(next) => {
            updateAttributes({ icon: next });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

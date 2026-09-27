import React, { forwardRef } from 'react';
import { InlineComposer, type ComposerHandle } from './inline-composer.js';
import { ResizablePrompt } from './resizable-prompt.js';
import type { InputMention } from './input-mentions.js';
import './prompt-field.css';

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  mentions?: InputMention[];
  disabled?: boolean;
  placeholder?: string;
};
export const PromptField = forwardRef<ComposerHandle, Props>(function PromptField(
  { id, value, onChange, mentions, disabled, placeholder = 'Describe what you want to create…' },
  ref,
) {
  return (
    <div className="prompt-field">
      {mentions !== undefined ? (
        <>
          <InlineComposer
            ref={ref}
            id={id}
            label="Prompt"
            value={value}
            mentions={mentions}
            placeholder={placeholder}
            disabled={disabled}
            expanded={false}
            multiline
            onChange={onChange}
            onSelect={() => {}}
            onKeyDown={() => {}}
            onPasteFiles={() => {}}
          />
          <small className="mention-help">Type @ to reference an input</small>
        </>
      ) : (
        <ResizablePrompt>
          <textarea
            id={id}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
          />
        </ResizablePrompt>
      )}
    </div>
  );
});

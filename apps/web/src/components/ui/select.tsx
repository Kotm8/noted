import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>
        <button type="button" className="select-trigger" aria-label={label}>
          <span>
            {options.find((option) => option.value === value)?.label ?? value}
          </span>
          <ChevronDown size={15} />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="dropdown-content select-options"
          sideOffset={5}
          align="start"
          collisionPadding={12}
        >
          <Dropdown.RadioGroup
            value={value}
            onValueChange={onChange}
            aria-label={label}
          >
            {options.map((option) => (
              <Dropdown.RadioItem
                className="dropdown-item select-option"
                key={option.value}
                value={option.value}
              >
                {option.label}
                <Dropdown.ItemIndicator>
                  <Check size={14} />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: Parameters<typeof clsx>) =>
  twMerge(clsx(...inputs));

const variants = cva("ui-button", {
  variants: {
    variant: {
      default: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      danger: "button-danger",
    },
    size: {
      default: "button-default",
      small: "button-small",
      icon: "button-icon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type Props = ComponentPropsWithRef<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: Props) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(variants({ variant, size }), className)}
      {...props}
    />
  );
}

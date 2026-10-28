import { Slot } from "@radix-ui/react-slot";
import type { ComponentPropsWithRef } from "react";

const variants = {
  default: "button-primary",
  secondary: "button-secondary",
  ghost: "button-ghost",
  danger: "button-danger",
};

const sizes = {
  default: "button-default",
  small: "button-small",
  icon: "button-icon",
};

type Props = ComponentPropsWithRef<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
};

export function Button({
  className,
  variant = "default",
  size = "default",
  asChild,
  ...props
}: Props) {
  const Component = asChild ? Slot : "button";
  const classes = ["ui-button", variants[variant], sizes[size], className];
  return <Component className={classes.filter(Boolean).join(" ")} {...props} />;
}

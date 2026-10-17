import { BrandIcon } from "../../../components/ui/brand-icon";

export function AuthBrand() {
  return (
    <header className="auth-brand">
      <div className="wordmark">
        <BrandIcon decorative />
        Noted
      </div>
      <p>Private notes, organized in channels.</p>
    </header>
  );
}

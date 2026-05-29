import { Suspense } from "react";
import { LoginForm } from "./login-form";

// Login page is a server-component shell wrapping the form in <Suspense>.
// The form uses useSearchParams() to read ?next=, which forces client-side
// rendering; without the Suspense boundary, `vercel build` bails out trying
// to prerender the page (CSR-bailout error on /login).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

import { SignIn } from "@clerk/nextjs";
import { AuthFrame } from "@/components/shell/auth-frame";

// Clerk's <SignIn /> also accepts organization invitation tickets: invite
// links point here, and it signs the person into the inviting organization.
export default function SignInPage() {
  return (
    <AuthFrame>
      <SignIn />
    </AuthFrame>
  );
}

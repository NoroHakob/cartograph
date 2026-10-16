import { SignUp } from "@clerk/nextjs";
import { AuthFrame } from "@/components/shell/auth-frame";

export default function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp />
    </AuthFrame>
  );
}

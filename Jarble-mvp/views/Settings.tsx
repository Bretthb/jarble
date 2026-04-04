"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Building2,
  ChevronLeft,
  Save,
  Loader2,
  User,
  Mail,
  Shield,
  Moon,
  Sun,
  KeyRound,
  MailCheck,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import ProfileDropdown from "@/components/ProfileDropdown";
import DeleteAccountSection from "@/components/DeleteAccountSection";

export default function SettingsView() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth0();
  const { theme, toggleTheme, switchable } = useTheme();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  const profileQuery = trpc.user.getProfile.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  const updateProfileMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Profile updated!");
      setHasChanges(false);
      profileQuery.refetch();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to update profile");
    },
    onSettled: () => setIsSaving(false),
  });

  // Populate form from profile data or Auth0 user
  useEffect(() => {
    if (profileQuery.data) {
      setName(profileQuery.data.name || "");
      setEmail(profileQuery.data.email || "");
    } else if (profileQuery.isError) {
      // Fall back to Auth0 user data if profile fails to load
      if (user) {
        setName(user.name || "");
        setEmail(user.email || "");
      }
      toast.error("Failed to load profile data");
    } else if (user) {
      setName(user.name || "");
      setEmail(user.email || "");
    }
  }, [profileQuery.data, profileQuery.isError, user]);

  const handleSave = () => {
    setIsSaving(true);
    updateProfileMutation.mutate({
      name: name.trim(),
    });
  };

  const isEmailPasswordUser = user?.sub?.startsWith("auth0|");

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setIsResettingPassword(true);
    try {
      const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? "";
      const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ?? "";
      const res = await fetch(`https://${domain}/dbconnections/change_password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          email: user.email,
          connection: "Username-Password-Authentication",
        }),
      });
      if (res.ok) {
        toast.success("Password reset email sent! Check your inbox.");
      } else {
        toast.error("Failed to send reset email. Please try again.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsResettingPassword(false);
    }
  };

  const resendVerificationMutation = trpc.user.resendVerificationEmail.useMutation({
    onSuccess: () => {
      toast.success("Verification email sent! Check your inbox.");
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to send verification email");
    },
    onSettled: () => setIsResendingVerification(false),
  });

  const handleResendVerification = () => {
    setIsResendingVerification(true);
    resendVerificationMutation.mutate();
  };

  const initials = (name || user?.name || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </nav>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-64 mb-8" />
          <Card className="p-6 bg-card border-border">
            <div className="flex items-center gap-4 mb-6">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div>
                <Skeleton className="h-5 w-32 mb-1.5" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 bg-card border-border text-center">
          <p className="text-muted-foreground mb-4">Please log in to view settings</p>
          <Button onClick={() => router.push("/login")}>Sign In</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="text-muted-foreground hover:text-foreground h-8 px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <a href="/" className="flex items-center gap-2 cursor-pointer no-underline text-foreground">
              <span className="font-semibold">Jarble</span>
            </a>
          </div>
          <ProfileDropdown />
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">Profile Settings</h1>
          <p className="text-muted-foreground text-sm">
            Manage your account information and preferences
          </p>
        </div>

        <div className="space-y-6">
          {/* Profile Section */}
          <Card className="p-6 bg-card border-border">
            <div className="flex items-center gap-4 mb-6">
              <Avatar className="h-16 w-16 border-2 border-border">
                <AvatarImage src={user?.picture} alt={name || "User"} />
                <AvatarFallback className="text-lg font-medium bg-secondary text-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="font-semibold text-lg">{name || user?.name || "User"}</h2>
                <p className="text-sm text-muted-foreground">{email || user?.email || ""}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="name" className="mb-2 block text-sm flex items-center gap-2">
                  <User className="w-3.5 h-3.5" />
                  Display Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setHasChanges(true);
                  }}
                  className="bg-secondary/50 border-border text-foreground"
                  placeholder="Your name"
                />
              </div>

              <div>
                <Label htmlFor="email" className="mb-2 block text-sm flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5" />
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setHasChanges(true);
                  }}
                  className="bg-secondary/50 border-border text-foreground"
                  placeholder="you@example.com"
                />
                {user?.email_verified ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Email verified
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Not verified
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end pt-2">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || isSaving}
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Save Changes
                </Button>
              </div>
            </div>
          </Card>

          {/* Appearance Section */}
          {switchable && toggleTheme && (
            <Card className="p-6 bg-card border-border">
              <h3 className="font-semibold mb-1">Appearance</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Choose your preferred theme
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => theme !== "light" && toggleTheme()}
                  className={`p-4 rounded-lg border-2 transition-all text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    theme === "light"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-white dark:bg-zinc-100 border border-border flex items-center justify-center">
                      <Sun className="w-4 h-4 text-amber-500" />
                    </div>
                    <span className="font-medium text-sm">Light</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Clean and bright interface</p>
                </button>
                <button
                  onClick={() => theme !== "dark" && toggleTheme()}
                  className={`p-4 rounded-lg border-2 transition-all text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    theme === "dark"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-zinc-800 border border-border flex items-center justify-center">
                      <Moon className="w-4 h-4 text-blue-400" />
                    </div>
                    <span className="font-medium text-sm">Dark</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Easy on the eyes</p>
                </button>
              </div>
            </Card>
          )}

          {/* Account Info */}
          <Card className="p-6 bg-card border-border">
            <h3 className="font-semibold mb-1">Account</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Account details and authentication
            </p>
            <div className="divide-y divide-border/50 text-sm">
              <div className="flex justify-between py-2.5 first:pt-0">
                <span className="text-muted-foreground">Auth Provider</span>
                <span className="font-medium">
                  {user?.sub?.startsWith("google") ? "Google" :
                   user?.sub?.startsWith("github") ? "GitHub" :
                   "Email/Password"}
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-muted-foreground">Email Verified</span>
                <span className={user?.email_verified ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                  {user?.email_verified ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex justify-between py-2.5 last:pb-0">
                <span className="text-muted-foreground">User ID</span>
                <span className="font-mono text-xs text-muted-foreground">{user?.sub?.slice(0, 20)}...</span>
              </div>
            </div>

            {!user?.email_verified && (
              <div className="mt-5 pt-5 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Email Verification</p>
                    <p className="text-xs text-muted-foreground">
                      Resend the verification link to your email
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResendVerification}
                    disabled={isResendingVerification}
                    className="border-border hover:bg-secondary/50"
                  >
                    {isResendingVerification ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <MailCheck className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Resend Verification
                  </Button>
                </div>
              </div>
            )}

            {isEmailPasswordUser && (
              <div className="mt-5 pt-5 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Password</p>
                    <p className="text-xs text-muted-foreground">
                      Send a password reset link to your email
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetPassword}
                    disabled={isResettingPassword}
                    className="border-border hover:bg-secondary/50"
                  >
                    {isResettingPassword ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Reset Password
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Organization */}
          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Organizations</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Create and manage your organizations, invite team members, and configure settings.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/orgs")}
            >
              Manage Organizations
            </Button>
          </Card>

          {/* Danger Zone */}
          <DeleteAccountSection />
        </div>
      </div>
    </div>
  );
}

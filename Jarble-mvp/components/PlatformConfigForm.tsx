"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  getPlatformConfig, 
  validatePlatformConfig,
  type PlatformConfig,
  type PlatformConfigField 
} from "@/lib/platformConfigs";
import { 
  ExternalLink, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";

interface PlatformConfigFormProps {
  platform: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  onValidate?: (valid: boolean) => void;
}

export function PlatformConfigForm({ 
  platform, 
  values, 
  onChange,
  onValidate 
}: PlatformConfigFormProps) {
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [showInstructions, setShowInstructions] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const config = getPlatformConfig(platform);
  
  if (!config) {
    return (
      <p className="text-sm text-muted-foreground">
        No configuration needed for this platform.
      </p>
    );
  }

  const handleChange = (fieldName: string, value: string) => {
    const newValues = { ...values, [fieldName]: value };
    onChange(newValues);
    
    // Clear error when user types
    if (errors[fieldName]) {
      setErrors({ ...errors, [fieldName]: "" });
    }
  };

  const handleBlur = () => {
    const { valid, errors: newErrors } = validatePlatformConfig(platform, values);
    setErrors(newErrors);
    onValidate?.(valid);
  };

  const togglePassword = (fieldName: string) => {
    setShowPasswords({ ...showPasswords, [fieldName]: !showPasswords[fieldName] });
  };

  return (
    <div className="space-y-4">
      {/* Setup Instructions */}
      <Card className="p-4 bg-secondary/50">
        <button
          type="button"
          onClick={() => setShowInstructions(!showInstructions)}
          className="w-full flex items-center justify-between text-sm font-medium"
        >
          <span>📖 Setup Instructions</span>
          {showInstructions ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
        
        {showInstructions && (
          <div className="mt-3 pt-3 border-t border-border">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans">
              {config.setupInstructions}
            </pre>
            {config.docsUrl && (
              <a
                href={config.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
              >
                Official Documentation <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </Card>

      {/* Config Fields */}
      {config.fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={field.name} className="flex items-center gap-1">
            {field.label}
            {field.required && <span className="text-destructive">*</span>}
          </Label>
          
          <div className="relative">
            {field.type === "textarea" ? (
              <textarea
                id={field.name}
                value={values[field.name] || ""}
                onChange={(e) => handleChange(field.name, e.target.value)}
                onBlur={handleBlur}
                placeholder={field.placeholder}
                rows={3}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <Input
                id={field.name}
                type={
                  field.type === "password" && !showPasswords[field.name]
                    ? "password"
                    : "text"
                }
                value={values[field.name] || ""}
                onChange={(e) => handleChange(field.name, e.target.value)}
                onBlur={handleBlur}
                placeholder={field.placeholder}
                className={errors[field.name] ? "border-destructive" : ""}
              />
            )}
            
            {field.type === "password" && (
              <button
                type="button"
                onClick={() => togglePassword(field.name)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPasswords[field.name] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          {/* Help text */}
          {field.helpText && !errors[field.name] && (
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              {field.helpText}
              {field.helpUrl && (
                <a
                  href={field.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </p>
          )}

          {/* Error message */}
          {errors[field.name] && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {errors[field.name]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Compact status indicator for platform config
 */
export function PlatformConfigStatus({ 
  platform, 
  config 
}: { 
  platform: string; 
  config: Record<string, string> | undefined;
}) {
  const platformConfig = getPlatformConfig(platform);
  
  if (!platformConfig) {
    return <span className="text-xs text-muted-foreground">No config needed</span>;
  }

  const { valid } = validatePlatformConfig(platform, config || {});
  
  if (valid && config && Object.keys(config).length > 0) {
    return (
      <span className="text-xs text-green-500 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" /> Configured
      </span>
    );
  }

  const requiredFields = platformConfig.fields.filter(f => f.required).length;
  
  return (
    <span className="text-xs text-amber-500 flex items-center gap-1">
      <AlertCircle className="w-3 h-3" /> {requiredFields} field{requiredFields !== 1 ? 's' : ''} required
    </span>
  );
}

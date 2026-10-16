// Generated from the database schema (Supabase `generate_typescript_types`).
// Don't edit by hand: change a migration, then regenerate.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          commit_sha: string | null
          created_at: string
          edge_count: number | null
          error: string | null
          file_count: number | null
          finished_at: string | null
          id: string
          org_id: string
          project_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["analysis_status"]
        }
        Insert: {
          commit_sha?: string | null
          created_at?: string
          edge_count?: number | null
          error?: string | null
          file_count?: number | null
          finished_at?: string | null
          id?: string
          org_id: string
          project_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_status"]
        }
        Update: {
          commit_sha?: string | null
          created_at?: string
          edge_count?: number | null
          error?: string | null
          file_count?: number | null
          finished_at?: string | null
          id?: string
          org_id?: string
          project_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_status"]
        }
        Relationships: [
          {
            foreignKeyName: "analyses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_project_id_org_id_fkey"
            columns: ["project_id", "org_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          id: string
          kind: string
          org_id: string
          resolved: boolean
          source_file_id: string
          specifier: string
          target_file_id: string | null
        }
        Insert: {
          analysis_id: string
          id?: string
          kind: string
          org_id: string
          resolved?: boolean
          source_file_id: string
          specifier: string
          target_file_id?: string | null
        }
        Update: {
          analysis_id?: string
          id?: string
          kind?: string
          org_id?: string
          resolved?: boolean
          source_file_id?: string
          specifier?: string
          target_file_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "edges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_file_id_org_id_fkey"
            columns: ["source_file_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "edges_target_file_id_org_id_fkey"
            columns: ["target_file_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      explanations: {
        Row: {
          analysis_id: string
          body: string
          created_at: string
          edge_id: string | null
          file_id: string | null
          folder: string | null
          id: string
          model: string
          org_id: string
        }
        Insert: {
          analysis_id: string
          body: string
          created_at?: string
          edge_id?: string | null
          file_id?: string | null
          folder?: string | null
          id?: string
          model: string
          org_id: string
        }
        Update: {
          analysis_id?: string
          body?: string
          created_at?: string
          edge_id?: string | null
          file_id?: string | null
          folder?: string | null
          id?: string
          model?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "explanations_edge_id_org_id_fkey"
            columns: ["edge_id", "org_id"]
            isOneToOne: false
            referencedRelation: "edges"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "explanations_file_id_org_id_fkey"
            columns: ["file_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "explanations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_roles: {
        Row: {
          analysis_id: string
          created_at: string
          file_id: string
          id: string
          model: string
          org_id: string
          rationale: string | null
          role: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          file_id: string
          id?: string
          model: string
          org_id: string
          rationale?: string | null
          role: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          file_id?: string
          id?: string
          model?: string
          org_id?: string
          rationale?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "file_roles_file_id_org_id_fkey"
            columns: ["file_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "file_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          analysis_id: string
          folder: string
          id: string
          language: string
          line_count: number
          org_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          folder: string
          id?: string
          language: string
          line_count: number
          org_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          folder?: string
          id?: string
          language?: string
          line_count?: number
          org_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          body: string
          created_at: string
          file_ids: string[]
          id: string
          kind: string
          model: string
          org_id: string
          title: string
        }
        Insert: {
          analysis_id: string
          body: string
          created_at?: string
          file_ids?: string[]
          id?: string
          kind: string
          model: string
          org_id: string
          title: string
        }
        Update: {
          analysis_id?: string
          body?: string
          created_at?: string
          file_ids?: string[]
          id?: string
          kind?: string
          model?: string
          org_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "insights_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          default_branch: string | null
          id: string
          org_id: string
          repo_name: string
          repo_owner: string
        }
        Insert: {
          created_at?: string
          default_branch?: string | null
          id?: string
          org_id: string
          repo_name: string
          repo_owner: string
        }
        Update: {
          created_at?: string
          default_branch?: string | null
          id?: string
          org_id?: string
          repo_name?: string
          repo_owner?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          kind: string
          methods: string[]
          org_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          kind: string
          methods?: string[]
          org_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          kind?: string
          methods?: string[]
          org_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "routes_file_id_org_id_fkey"
            columns: ["file_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      analysis_status:
        | "queued"
        | "parsing"
        | "explaining"
        | "complete"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      analysis_status: [
        "queued",
        "parsing",
        "explaining",
        "complete",
        "failed",
      ],
    },
  },
} as const

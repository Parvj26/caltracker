export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      client_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          created_by: string
          email: string
          expires_at: string
          first_name: string
          full_name: string
          id: string
          last_name: string
          sent_at: string
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          created_by: string
          email: string
          expires_at?: string
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          sent_at?: string
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          created_by?: string
          email?: string
          expires_at?: string
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          sent_at?: string
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_overrides: {
        Row: {
          coach_notes: string | null
          exercise_id: string
          updated_at: string | null
          workspace_id: string
          youtube_url: string | null
        }
        Insert: {
          coach_notes?: string | null
          exercise_id: string
          updated_at?: string | null
          workspace_id: string
          youtube_url?: string | null
        }
        Update: {
          coach_notes?: string | null
          exercise_id?: string
          updated_at?: string | null
          workspace_id?: string
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercise_overrides_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_overrides_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string | null
          equipment: string | null
          external_id: string | null
          id: string
          image_paths: string[]
          instructions: string[]
          name: string
          primary_muscles: string[]
          secondary_muscles: string[]
          source: string
          tracking_type: Database["public"]["Enums"]["tracking_type"]
          workspace_id: string | null
          youtube_url: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          equipment?: string | null
          external_id?: string | null
          id?: string
          image_paths?: string[]
          instructions?: string[]
          name: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
          source: string
          tracking_type: Database["public"]["Enums"]["tracking_type"]
          workspace_id?: string | null
          youtube_url?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          equipment?: string | null
          external_id?: string | null
          id?: string
          image_paths?: string[]
          instructions?: string[]
          name?: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
          source?: string
          tracking_type?: Database["public"]["Enums"]["tracking_type"]
          workspace_id?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      past_clients: {
        Row: {
          email: string
          first_name: string
          full_name: string | null
          joined_at: string | null
          last_name: string
          removed_at: string
          removed_by: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          email: string
          first_name?: string
          full_name?: string | null
          joined_at?: string | null
          last_name?: string
          removed_at?: string
          removed_by?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          email?: string
          first_name?: string
          full_name?: string | null
          joined_at?: string | null
          last_name?: string
          removed_at?: string
          removed_by?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "past_clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string | null
          first_name: string
          full_name: string
          id: string
          last_name: string
          units: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string | null
          first_name?: string
          full_name?: string
          id: string
          last_name?: string
          units?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string | null
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          units?: string
        }
        Relationships: []
      }
      program_workouts: {
        Row: {
          created_at: string
          day: number
          id: string
          position: number
          program_id: string
          updated_at: string
          week: number
          workout_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          day: number
          id?: string
          position?: number
          program_id: string
          updated_at?: string
          week: number
          workout_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          day?: number
          id?: string
          position?: number
          program_id?: string
          updated_at?: string
          week?: number
          workout_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_workouts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_workouts_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
          weeks: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          weeks?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          weeks?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_blocks: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["block_kind"]
          position: number
          updated_at: string
          workout_id: string
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["block_kind"]
          position: number
          updated_at?: string
          workout_id: string
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["block_kind"]
          position?: number
          updated_at?: string
          workout_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_blocks_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_exercises: {
        Row: {
          block_id: string
          client_id: string | null
          created_at: string
          exercise_id: string
          id: string
          note: string | null
          position: number
          updated_at: string
          workout_id: string
          workspace_id: string
        }
        Insert: {
          block_id: string
          client_id?: string | null
          created_at?: string
          exercise_id: string
          id?: string
          note?: string | null
          position: number
          updated_at?: string
          workout_id: string
          workspace_id: string
        }
        Update: {
          block_id?: string
          client_id?: string | null
          created_at?: string
          exercise_id?: string
          id?: string
          note?: string | null
          position?: number
          updated_at?: string
          workout_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_exercises_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "workout_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sets: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          note: string | null
          position: number
          rest_seconds: number
          set_type: Database["public"]["Enums"]["set_type"]
          target_distance_m: number | null
          target_duration_s: number | null
          target_reps_max: number | null
          target_reps_min: number | null
          target_weight_kg: number | null
          to_failure: boolean
          updated_at: string
          workout_exercise_id: string
          workout_id: string
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          position: number
          rest_seconds?: number
          set_type?: Database["public"]["Enums"]["set_type"]
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_reps_max?: number | null
          target_reps_min?: number | null
          target_weight_kg?: number | null
          to_failure?: boolean
          updated_at?: string
          workout_exercise_id: string
          workout_id: string
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          position?: number
          rest_seconds?: number
          set_type?: Database["public"]["Enums"]["set_type"]
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_reps_max?: number | null
          target_reps_min?: number | null
          target_weight_kg?: number | null
          to_failure?: boolean
          updated_at?: string
          workout_exercise_id?: string
          workout_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_sets_workout_exercise_id_fkey"
            columns: ["workout_exercise_id"]
            isOneToOne: false
            referencedRelation: "workout_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          assignment_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          scheduled_on: string | null
          source_workout_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignment_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          scheduled_on?: string | null
          source_workout_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignment_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          scheduled_on?: string | null
          source_workout_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_source_workout_id_fkey"
            columns: ["source_workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string | null
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          badge_style: string
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          badge_style?: string
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          badge_style?: string
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite_for: {
        Args: { p_invite_id: string; p_user_id: string }
        Returns: string
      }
      claim_invites: {
        Args: never
        Returns: {
          workspace_id: string
          workspace_name: string
        }[]
      }
      exercise_usable_in: { Args: { ex: string; ws: string }; Returns: boolean }
      get_invite_preview: {
        Args: { token: string }
        Returns: {
          email: string
          first_name: string
          full_name: string
          last_name: string
          status: string
          workspace_name: string
        }[]
      }
      invite_for_join: {
        Args: { token: string }
        Returns: {
          email: string
          first_name: string
          invite_id: string
          last_name: string
          status: string
          user_confirmed: boolean
          user_id: string
          user_is_coach: boolean
          workspace_id: string
          workspace_name: string
        }[]
      }
      is_client_in: { Args: { uid: string; ws: string }; Returns: boolean }
      is_coach_of: { Args: { ws: string }; Returns: boolean }
      is_library_workout_of: {
        Args: { w: string; ws: string }
        Returns: boolean
      }
      is_member_of: { Args: { ws: string }; Returns: boolean }
      lookup_members_by_email: {
        Args: { emails: string[] }
        Returns: {
          email: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }[]
      }
      my_removal: {
        Args: never
        Returns: {
          removed_at: string
          workspace_name: string
        }[]
      }
      remove_client: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: undefined
      }
      save_workout: {
        Args: { p_doc: Json; p_workspace_id: string }
        Returns: string
      }
      set_program_weeks: {
        Args: { p_program_id: string; p_weeks: number }
        Returns: number
      }
      shares_workspace_with: { Args: { other: string }; Returns: boolean }
      split_full_name: { Args: { name: string }; Returns: string[] }
    }
    Enums: {
      block_kind: "straight" | "superset"
      member_role: "owner" | "staff" | "client"
      set_type: "normal" | "warmup" | "drop"
      tracking_type: "weight_reps" | "reps" | "time" | "distance"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      block_kind: ["straight", "superset"],
      member_role: ["owner", "staff", "client"],
      set_type: ["normal", "warmup", "drop"],
      tracking_type: ["weight_reps", "reps", "time", "distance"],
    },
  },
} as const


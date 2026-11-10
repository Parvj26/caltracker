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
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          at: string
          details: Json
          id: number
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id: string
          at?: string
          details?: Json
          id?: never
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          at?: string
          details?: Json
          id?: never
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["admin_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: Database["public"]["Enums"]["admin_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["admin_role"]
          user_id?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          id: boolean
          ios_latest_build: number
          ios_min_build: number
          ios_update_url: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          ios_latest_build?: number
          ios_min_build?: number
          ios_update_url?: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          ios_latest_build?: number
          ios_min_build?: number
          ios_update_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      award_catchup_attempts: {
        Row: {
          attempts: number
          last_attempt_at: string
          log_id: string
        }
        Insert: {
          attempts?: number
          last_attempt_at?: string
          log_id: string
        }
        Update: {
          attempts?: number
          last_attempt_at?: string
          log_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "award_catchup_attempts_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: true
            referencedRelation: "workout_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      awards: {
        Row: {
          client_id: string
          created_at: string
          ladder_sticker_key: string | null
          log_id: string
          log_revision: number
          result: Json
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          ladder_sticker_key?: string | null
          log_id: string
          log_revision?: number
          result: Json
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          ladder_sticker_key?: string | null
          log_id?: string
          log_revision?: number
          result?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "awards_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: true
            referencedRelation: "workout_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      body_measurement_values: {
        Row: {
          measurement_id: string
          metric_key: string
          value: number
        }
        Insert: {
          measurement_id: string
          metric_key: string
          value: number
        }
        Update: {
          measurement_id?: string
          metric_key?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "body_measurement_values_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "body_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      body_measurements: {
        Row: {
          attachment_path: string | null
          client_id: string
          created_at: string
          entered_by: string | null
          id: string
          measured_on: string
          source: string
          workspace_id: string
        }
        Insert: {
          attachment_path?: string | null
          client_id: string
          created_at?: string
          entered_by?: string | null
          id?: string
          measured_on: string
          source: string
          workspace_id: string
        }
        Update: {
          attachment_path?: string | null
          client_id?: string
          created_at?: string
          entered_by?: string | null
          id?: string
          measured_on?: string
          source?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "body_measurements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_documents: {
        Row: {
          client_id: string
          content_type: string
          created_at: string
          id: string
          name: string
          shared_with_client: boolean
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          client_id: string
          content_type: string
          created_at?: string
          id?: string
          name: string
          shared_with_client?: boolean
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          client_id?: string
          content_type?: string
          created_at?: string
          id?: string
          name?: string
          shared_with_client?: boolean
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_goals: {
        Row: {
          client_id: string
          goal: string
          target_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          goal: string
          target_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          goal?: string
          target_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invite_plan_items: {
        Row: {
          created_at: string
          id: string
          invite_id: string
          position: number
          program_id: string | null
          start_on: string
          workout_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_id: string
          position?: number
          program_id?: string | null
          start_on: string
          workout_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_id?: string
          position?: number
          program_id?: string | null
          start_on?: string
          workout_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invite_plan_items_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "client_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invite_plan_items_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invite_plan_items_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invite_plan_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
      client_limitations: {
        Row: {
          body: string
          client_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body?: string
          client_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          client_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_limitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          body: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_stats: {
        Row: {
          best_streak: number
          client_id: string
          journey_week: number
          lifetime_volume_kg: number
          pr_count: number
          streak: number
          streak_week: string | null
          updated_at: string
          workouts: number
          workspace_id: string
        }
        Insert: {
          best_streak?: number
          client_id: string
          journey_week?: number
          lifetime_volume_kg?: number
          pr_count?: number
          streak?: number
          streak_week?: string | null
          updated_at?: string
          workouts?: number
          workspace_id: string
        }
        Update: {
          best_streak?: number
          client_id?: string
          journey_week?: number
          lifetime_volume_kg?: number
          pr_count?: number
          streak?: number
          streak_week?: string | null
          updated_at?: string
          workouts?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_stats_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_meals: {
        Row: {
          calories: number | null
          carbs_g: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          fat_g: number | null
          how_to: string
          id: string
          ingredients: string
          name: string
          photo_height: number | null
          photo_path: string | null
          photo_thumb_path: string | null
          photo_width: number | null
          protein_g: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          fat_g?: number | null
          how_to?: string
          id?: string
          ingredients?: string
          name: string
          photo_height?: number | null
          photo_path?: string | null
          photo_thumb_path?: string | null
          photo_width?: number | null
          protein_g?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          fat_g?: number | null
          how_to?: string
          id?: string
          ingredients?: string
          name?: string
          photo_height?: number | null
          photo_path?: string | null
          photo_thumb_path?: string | null
          photo_width?: number | null
          protein_g?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_meals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      communities: {
        Row: {
          activity_at: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          workspace_id: string
        }
        Insert: {
          activity_at?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          workspace_id: string
        }
        Update: {
          activity_at?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          workspace_id: string
        }
        Insert: {
          blocked_id: string
          blocker_id?: string
          created_at?: string
          workspace_id: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_blocks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_comments: {
        Row: {
          author_id: string
          body: string
          community_id: string
          created_at: string
          id: string
          post_id: string
          workspace_id: string
        }
        Insert: {
          author_id?: string
          body: string
          community_id: string
          created_at?: string
          id?: string
          post_id: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string
          community_id?: string
          created_at?: string
          id?: string
          post_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_members: {
        Row: {
          community_id: string
          joined_at: string
          removed_at: string | null
          removed_by: string | null
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          community_id: string
          joined_at?: string
          removed_at?: string | null
          removed_by?: string | null
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          community_id?: string
          joined_at?: string
          removed_at?: string | null
          removed_by?: string | null
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_workspace_id_fkey"
            columns: ["community_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "community_members_workspace_id_user_id_fkey"
            columns: ["workspace_id", "user_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "user_id"]
          },
        ]
      }
      community_notifications: {
        Row: {
          actor_id: string | null
          comment_id: string | null
          community_id: string
          created_at: string
          id: string
          kind: string
          post_id: string | null
          read_at: string | null
          recipient_id: string
          report_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          comment_id?: string | null
          community_id: string
          created_at?: string
          id?: string
          kind: string
          post_id?: string | null
          read_at?: string | null
          recipient_id: string
          report_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          comment_id?: string | null
          community_id?: string
          created_at?: string
          id?: string
          kind?: string
          post_id?: string | null
          read_at?: string | null
          recipient_id?: string
          report_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_notifications_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_notifications_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "community_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_post_images: {
        Row: {
          height: number
          id: string
          path: string
          position: number
          post_id: string
          thumb_path: string
          width: number
          workspace_id: string
        }
        Insert: {
          height: number
          id?: string
          path: string
          position: number
          post_id: string
          thumb_path: string
          width: number
          workspace_id: string
        }
        Update: {
          height?: number
          id?: string
          path?: string
          position?: number
          post_id?: string
          thumb_path?: string
          width?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_post_images_post_id_workspace_id_fkey"
            columns: ["post_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_id: string
          body: string
          card: Json | null
          community_id: string
          created_at: string
          id: string
          image_count: number
          pinned_at: string | null
          pinned_by: string | null
          workspace_id: string
        }
        Insert: {
          author_id: string
          body?: string
          card?: Json | null
          community_id: string
          created_at?: string
          id?: string
          image_count?: number
          pinned_at?: string | null
          pinned_by?: string | null
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string
          card?: Json | null
          community_id?: string
          created_at?: string
          id?: string
          image_count?: number
          pinned_at?: string | null
          pinned_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_community_id_workspace_id_fkey"
            columns: ["community_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      community_reactions: {
        Row: {
          comment_id: string | null
          community_id: string
          created_at: string
          id: string
          post_id: string
          reaction: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          comment_id?: string | null
          community_id: string
          created_at?: string
          id?: string
          post_id: string
          reaction: string
          user_id?: string
          workspace_id: string
        }
        Update: {
          comment_id?: string | null
          community_id?: string
          created_at?: string
          id?: string
          post_id?: string
          reaction?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_reports: {
        Row: {
          comment_id: string | null
          community_id: string
          created_at: string
          id: string
          note: string
          post_id: string | null
          reason: string
          reporter_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          target_author_id: string | null
          target_body: string
          target_image_count: number
          target_kind: string
          workspace_id: string
        }
        Insert: {
          comment_id?: string | null
          community_id: string
          created_at?: string
          id?: string
          note?: string
          post_id?: string | null
          reason: string
          reporter_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          target_author_id?: string | null
          target_body?: string
          target_image_count?: number
          target_kind: string
          workspace_id: string
        }
        Update: {
          comment_id?: string | null
          community_id?: string
          created_at?: string
          id?: string
          note?: string
          post_id?: string | null
          reason?: string
          reporter_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          target_author_id?: string | null
          target_body?: string
          target_image_count?: number
          target_kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reports_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          client_id: string
          created_at: string
          id: string
          last_message_at: string | null
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_metrics: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          max: number
          min: number
          name: string
          unit_label: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          max: number
          min: number
          name: string
          unit_label?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          max?: number
          min?: number
          name?: string
          unit_label?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_metrics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_favorites: {
        Row: {
          coach_id: string
          created_at: string | null
          exercise_id: string
        }
        Insert: {
          coach_id?: string
          created_at?: string | null
          exercise_id: string
        }
        Update: {
          coach_id?: string
          created_at?: string | null
          exercise_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_favorites_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
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
      exercise_prefs: {
        Row: {
          each_side: boolean
          exercise_id: string
          tracking_type: Database["public"]["Enums"]["tracking_type"] | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          each_side?: boolean
          exercise_id: string
          tracking_type?: Database["public"]["Enums"]["tracking_type"] | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          each_side?: boolean
          exercise_id?: string
          tracking_type?: Database["public"]["Enums"]["tracking_type"] | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_prefs_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_prefs_workspace_id_fkey"
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
      live_sync_tombstones: {
        Row: {
          assignment_id: string
          created_at: string
          planned_on: string
          source_workout_id: string
          workspace_id: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          planned_on: string
          source_workout_id: string
          workspace_id: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          planned_on?: string
          source_workout_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_sync_tombstones_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "program_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_sync_tombstones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      log_blocks: {
        Row: {
          client_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["block_kind"]
          log_id: string
          picked_exercise_id: string | null
          position: number
          section_id: string | null
          section_name: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["block_kind"]
          log_id: string
          picked_exercise_id?: string | null
          position: number
          section_id?: string | null
          section_name?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["block_kind"]
          log_id?: string
          picked_exercise_id?: string | null
          position?: number
          section_id?: string | null
          section_name?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "log_blocks_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "workout_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      log_exercises: {
        Row: {
          block_id: string
          client_id: string
          created_at: string
          each_side: boolean
          exercise_id: string
          id: string
          log_id: string
          note: string | null
          planned_workout_exercise_id: string | null
          position: number
          substitute_id: string | null
          substitute_options: Json
          swapped_from_exercise_id: string | null
          tempo: string | null
          tracking_type: Database["public"]["Enums"]["tracking_type"] | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          block_id: string
          client_id: string
          created_at?: string
          each_side?: boolean
          exercise_id: string
          id?: string
          log_id: string
          note?: string | null
          planned_workout_exercise_id?: string | null
          position: number
          substitute_id?: string | null
          substitute_options?: Json
          swapped_from_exercise_id?: string | null
          tempo?: string | null
          tracking_type?: Database["public"]["Enums"]["tracking_type"] | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          block_id?: string
          client_id?: string
          created_at?: string
          each_side?: boolean
          exercise_id?: string
          id?: string
          log_id?: string
          note?: string | null
          planned_workout_exercise_id?: string | null
          position?: number
          substitute_id?: string | null
          substitute_options?: Json
          swapped_from_exercise_id?: string | null
          tempo?: string | null
          tracking_type?: Database["public"]["Enums"]["tracking_type"] | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "log_exercises_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "log_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "log_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "log_exercises_swapped_from_exercise_id_fkey"
            columns: ["swapped_from_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      log_sets: {
        Row: {
          actual_distance_m: number | null
          actual_duration_s: number | null
          actual_reps: number | null
          actual_weight_kg: number | null
          client_id: string
          completed_at: string | null
          created_at: string
          id: string
          log_exercise_id: string
          log_id: string
          position: number
          rest_seconds: number | null
          set_type: Database["public"]["Enums"]["set_type"]
          target_distance_m: number | null
          target_duration_s: number | null
          target_reps_max: number | null
          target_reps_min: number | null
          target_weight_kg: number | null
          to_failure: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_distance_m?: number | null
          actual_duration_s?: number | null
          actual_reps?: number | null
          actual_weight_kg?: number | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          log_exercise_id: string
          log_id: string
          position: number
          rest_seconds?: number | null
          set_type?: Database["public"]["Enums"]["set_type"]
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_reps_max?: number | null
          target_reps_min?: number | null
          target_weight_kg?: number | null
          to_failure?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual_distance_m?: number | null
          actual_duration_s?: number | null
          actual_reps?: number | null
          actual_weight_kg?: number | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          log_exercise_id?: string
          log_id?: string
          position?: number
          rest_seconds?: number | null
          set_type?: Database["public"]["Enums"]["set_type"]
          target_distance_m?: number | null
          target_duration_s?: number | null
          target_reps_max?: number | null
          target_reps_min?: number | null
          target_weight_kg?: number | null
          to_failure?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "log_sets_log_exercise_id_fkey"
            columns: ["log_exercise_id"]
            isOneToOne: false
            referencedRelation: "log_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      meals: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          coach_meal_id: string | null
          created_at: string
          eaten_at: string
          eaten_on: string
          fat_g: number | null
          id: string
          name: string | null
          note: string
          photo_height: number | null
          photo_path: string | null
          photo_thumb_path: string | null
          photo_width: number | null
          protein_g: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          coach_meal_id?: string | null
          created_at?: string
          eaten_at?: string
          eaten_on: string
          fat_g?: number | null
          id?: string
          name?: string | null
          note?: string
          photo_height?: number | null
          photo_path?: string | null
          photo_thumb_path?: string | null
          photo_width?: number | null
          protein_g?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          coach_meal_id?: string | null
          created_at?: string
          eaten_at?: string
          eaten_on?: string
          fat_g?: number | null
          id?: string
          name?: string | null
          note?: string
          photo_height?: number | null
          photo_path?: string | null
          photo_thumb_path?: string | null
          photo_width?: number | null
          protein_g?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meals_coach_meal_fk"
            columns: ["workspace_id", "coach_meal_id"]
            isOneToOne: false
            referencedRelation: "coach_meals"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "meals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          client_msg_id: string
          conversation_id: string
          created_at: string
          id: string
          image_paths: string[]
          sender_id: string
          workspace_id: string
        }
        Insert: {
          body?: string
          client_msg_id?: string
          conversation_id: string
          created_at?: string
          id?: string
          image_paths?: string[]
          sender_id?: string
          workspace_id: string
        }
        Update: {
          body?: string
          client_msg_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          image_paths?: string[]
          sender_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          disabled: string[]
          quiet_enabled: boolean
          quiet_end: string
          quiet_start: string
          reminder_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          disabled?: string[]
          quiet_enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          reminder_time?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          disabled?: string[]
          quiet_enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          reminder_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_targets: {
        Row: {
          calories: number | null
          carbs_g: number | null
          client_id: string
          fat_g: number | null
          protein_g: number | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          calories?: number | null
          carbs_g?: number | null
          client_id: string
          fat_g?: number | null
          protein_g?: number | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          calories?: number | null
          carbs_g?: number | null
          client_id?: string
          fat_g?: number | null
          protein_g?: number | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_targets_workspace_id_fkey"
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
      personal_records: {
        Row: {
          achieved_at: string
          client_id: string
          exercise_id: string
          id: string
          kind: string
          log_id: string | null
          reps: number | null
          value_kg: number
          workspace_id: string
        }
        Insert: {
          achieved_at: string
          client_id: string
          exercise_id: string
          id?: string
          kind: string
          log_id?: string | null
          reps?: number | null
          value_kg: number
          workspace_id: string
        }
        Update: {
          achieved_at?: string
          client_id?: string
          exercise_id?: string
          id?: string
          kind?: string
          log_id?: string | null
          reps?: number | null
          value_kg?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_records_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_records_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "workout_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_records_workspace_id_fkey"
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
          bio: string
          created_at: string | null
          first_name: string
          full_name: string
          id: string
          last_name: string
          time_zone: string
          units: string
          updated_at: string | null
        }
        Insert: {
          avatar_path?: string | null
          bio?: string
          created_at?: string | null
          first_name?: string
          full_name?: string
          id: string
          last_name?: string
          time_zone?: string
          units?: string
          updated_at?: string | null
        }
        Update: {
          avatar_path?: string | null
          bio?: string
          created_at?: string | null
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          time_zone?: string
          units?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      program_assignments: {
        Row: {
          cancelled_on: string | null
          client_id: string
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          program_id: string | null
          program_name: string
          start_date: string
          updated_at: string
          weeks: number
          workspace_id: string
        }
        Insert: {
          cancelled_on?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          program_id?: string | null
          program_name: string
          start_date: string
          updated_at?: string
          weeks: number
          workspace_id: string
        }
        Update: {
          cancelled_on?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          program_id?: string | null
          program_name?: string
          start_date?: string
          updated_at?: string
          weeks?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_assignments_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      program_live_sync_queue: {
        Row: {
          program_id: string
          xact: unknown
        }
        Insert: {
          program_id: string
          xact?: unknown
        }
        Update: {
          program_id?: string
          xact?: unknown
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
          auto_progression: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          live_sync: boolean
          live_sync_skipped: number
          live_synced_at: string | null
          name: string
          updated_at: string
          weeks: number
          workspace_id: string
        }
        Insert: {
          auto_progression?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          live_sync?: boolean
          live_sync_skipped?: number
          live_synced_at?: string | null
          name: string
          updated_at?: string
          weeks?: number
          workspace_id: string
        }
        Update: {
          auto_progression?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          live_sync?: boolean
          live_sync_skipped?: number
          live_synced_at?: string | null
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
      push_devices: {
        Row: {
          app_version: string | null
          created_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_outbox: {
        Row: {
          attempts: number
          body: string | null
          claimed_until: string | null
          created_at: string
          data: Json
          group_key: string
          id: string
          last_error: string | null
          not_before: string
          outcome: string | null
          sent_at: string | null
          title: string | null
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          attempts?: number
          body?: string | null
          claimed_until?: string | null
          created_at?: string
          data?: Json
          group_key: string
          id?: string
          last_error?: string | null
          not_before?: string
          outcome?: string | null
          sent_at?: string | null
          title?: string | null
          type: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          attempts?: number
          body?: string | null
          claimed_until?: string | null
          created_at?: string
          data?: Json
          group_key?: string
          id?: string
          last_error?: string | null
          not_before?: string
          outcome?: string | null
          sent_at?: string | null
          title?: string | null
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_outbox_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      push_sender_state: {
        Row: {
          apns_jwt: string | null
          apns_jwt_issued_at: string | null
          apns_key_id: string | null
          id: number
        }
        Insert: {
          apns_jwt?: string | null
          apns_jwt_issued_at?: string | null
          apns_key_id?: string | null
          id?: number
        }
        Update: {
          apns_jwt?: string | null
          apns_jwt_issued_at?: string | null
          apns_key_id?: string | null
          id?: number
        }
        Relationships: []
      }
      sticker_awards: {
        Row: {
          client_id: string
          count: number
          first_earned_at: string
          first_log_id: string | null
          last_earned_at: string
          shiny: boolean
          sticker_key: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          count?: number
          first_earned_at?: string
          first_log_id?: string | null
          last_earned_at?: string
          shiny?: boolean
          sticker_key: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          count?: number
          first_earned_at?: string
          first_log_id?: string | null
          last_earned_at?: string
          shiny?: boolean
          sticker_key?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_awards_first_log_id_fkey"
            columns: ["first_log_id"]
            isOneToOne: false
            referencedRelation: "workout_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_awards_workspace_id_fkey"
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
          section_id: string | null
          section_name: string | null
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
          section_id?: string | null
          section_name?: string | null
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
          section_id?: string | null
          section_name?: string | null
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
          each_side: boolean
          exercise_id: string
          id: string
          note: string | null
          position: number
          tempo: string | null
          tracking_type: Database["public"]["Enums"]["tracking_type"] | null
          updated_at: string
          workout_id: string
          workspace_id: string
        }
        Insert: {
          block_id: string
          client_id?: string | null
          created_at?: string
          each_side?: boolean
          exercise_id: string
          id?: string
          note?: string | null
          position: number
          tempo?: string | null
          tracking_type?: Database["public"]["Enums"]["tracking_type"] | null
          updated_at?: string
          workout_id: string
          workspace_id: string
        }
        Update: {
          block_id?: string
          client_id?: string | null
          created_at?: string
          each_side?: boolean
          exercise_id?: string
          id?: string
          note?: string | null
          position?: number
          tempo?: string | null
          tracking_type?: Database["public"]["Enums"]["tracking_type"] | null
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
      workout_log_comments: {
        Row: {
          author_id: string | null
          body: string
          client_id: string
          created_at: string
          id: string
          log_id: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          client_id: string
          created_at?: string
          id?: string
          log_id: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          client_id?: string
          created_at?: string
          id?: string
          log_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_log_comments_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "workout_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_logs: {
        Row: {
          auto_finished: boolean
          client_id: string
          corrected_at: string | null
          corrected_by: string | null
          created_at: string
          finished_at: string | null
          id: string
          last_activity_at: string
          logged_by: string | null
          name: string
          notes: string | null
          revision: number
          started_at: string
          status: Database["public"]["Enums"]["log_status"]
          taken_over_from: string | null
          updated_at: string
          workout_id: string | null
          workspace_id: string
        }
        Insert: {
          auto_finished?: boolean
          client_id: string
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          last_activity_at?: string
          logged_by?: string | null
          name: string
          notes?: string | null
          revision?: number
          started_at?: string
          status?: Database["public"]["Enums"]["log_status"]
          taken_over_from?: string | null
          updated_at?: string
          workout_id?: string | null
          workspace_id: string
        }
        Update: {
          auto_finished?: boolean
          client_id?: string
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          last_activity_at?: string
          logged_by?: string | null
          name?: string
          notes?: string | null
          revision?: number
          started_at?: string
          status?: Database["public"]["Enums"]["log_status"]
          taken_over_from?: string | null
          updated_at?: string
          workout_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_logs_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
      workout_substitutes: {
        Row: {
          client_id: string | null
          created_at: string
          exercise_id: string
          id: string
          note: string | null
          position: number
          sets: Json
          updated_at: string
          workout_exercise_id: string
          workout_id: string
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          exercise_id: string
          id?: string
          note?: string | null
          position: number
          sets: Json
          updated_at?: string
          workout_exercise_id: string
          workout_id: string
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          exercise_id?: string
          id?: string
          note?: string | null
          position?: number
          sets?: Json
          updated_at?: string
          workout_exercise_id?: string
          workout_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_substitutes_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_substitutes_workout_exercise_id_fkey"
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
          customised_at: string | null
          id: string
          name: string
          notes: string | null
          planned_on: string | null
          scheduled_on: string | null
          source_hash: string | null
          source_workout_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignment_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          customised_at?: string | null
          id?: string
          name: string
          notes?: string | null
          planned_on?: string | null
          scheduled_on?: string | null
          source_hash?: string | null
          source_workout_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignment_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          customised_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          planned_on?: string | null
          scheduled_on?: string | null
          source_hash?: string | null
          source_workout_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "program_assignments"
            referencedColumns: ["id"]
          },
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
      account_deletion_info: {
        Args: { p_user: string }
        Returns: {
          client_name: string
          coach_email: string
          coach_first_name: string
          is_coach: boolean
          workspace_name: string
        }[]
      }
      admin_audit: {
        Args: { p_limit?: number }
        Returns: {
          action: string
          admin_id: string
          admin_name: string
          at: string
          details: Json
          id: number
          target_name: string
          target_user_id: string
        }[]
      }
      admin_can_invite: {
        Args: { p_emails?: string[]; p_workspace_id: string }
        Returns: boolean
      }
      admin_cancel_invite: { Args: { p_invite_id: string }; Returns: undefined }
      admin_client: { Args: { p_user_id: string }; Returns: Json }
      admin_coach: { Args: { p_user_id: string }; Returns: Json }
      admin_coaches: {
        Args: never
        Returns: {
          clients: number
          created_at: string
          health: string
          last_active: string
          messages_7d: number
          name: string
          programs_assigned_7d: number
          user_id: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_invite_log: {
        Args: { p_limit?: number; p_user_id?: string }
        Returns: {
          accepted_at: string
          created_at: string
          email: string
          expires_at: string
          first_name: string
          id: string
          last_name: string
          status: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_list_admins: {
        Args: never
        Returns: {
          created_at: string
          email: string
          first_name: string
          last_name: string
          role: Database["public"]["Enums"]["admin_role"]
          user_id: string
        }[]
      }
      admin_log_action: {
        Args: { p_action: string; p_details: Json; p_target: string }
        Returns: undefined
      }
      admin_log_timeline_view: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      admin_me: {
        Args: never
        Returns: {
          email: string
          role: Database["public"]["Enums"]["admin_role"]
        }[]
      }
      admin_needs_attention: {
        Args: never
        Returns: {
          action: string
          invite_id: string
          kind: string
          name: string
          since: string
          user_id: string
        }[]
      }
      admin_overview: { Args: never; Returns: Json }
      admin_people: {
        Args: never
        Returns: {
          coach_name: string
          email: string
          kind: string
          name: string
          user_id: string
        }[]
      }
      admin_push_log: {
        Args: { p_limit?: number; p_user_id?: string }
        Returns: {
          at: string
          attempts: number
          id: string
          last_error: string
          name: string
          outcome: string
          sent_at: string
          type: string
          user_id: string
        }[]
      }
      admin_remove_admin: { Args: { p_user_id: string }; Returns: undefined }
      admin_remove_client: { Args: { p_user_id: string }; Returns: undefined }
      admin_send_test_push: { Args: { p_user_id: string }; Returns: string }
      admin_set_admin: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["admin_role"]
        }
        Returns: string
      }
      admin_view_as_snapshot: { Args: { p_user_id: string }; Returns: Json }
      apply_award: { Args: { p_log_id: string; p_result: Json }; Returns: Json }
      assign_program: {
        Args: {
          p_assignment_id: string
          p_client_id: string
          p_program_id: string
          p_start_date: string
        }
        Returns: string
      }
      auto_finish_stale_logs: { Args: never; Returns: number }
      award_catchup: { Args: never; Returns: number }
      award_history_version: {
        Args: { p_client_id: string; p_workspace_id: string }
        Returns: string
      }
      award_inputs: { Args: { p_log_id: string }; Returns: Json }
      build_community_card: {
        Args: { p_author_id: string; p_card: Json; p_workspace_id: string }
        Returns: Json
      }
      can_access_coach_meal_photo: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      can_access_meal_photo: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      can_access_message_image: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      can_block_in_community: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: boolean
      }
      can_post_to_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_read_community_image: { Args: { p_name: string }; Returns: boolean }
      can_read_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_upload_community_image: { Args: { p_name: string }; Returns: boolean }
      can_view_community: { Args: { p_community_id: string }; Returns: boolean }
      claim_invites: {
        Args: never
        Returns: {
          workspace_id: string
          workspace_name: string
        }[]
      }
      claim_push_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body: string | null
          claimed_until: string | null
          created_at: string
          data: Json
          group_key: string
          id: string
          last_error: string | null
          not_before: string
          outcome: string | null
          sent_at: string | null
          title: string | null
          type: string
          user_id: string
          workspace_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "push_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      client_today: {
        Args: { p_client: string; p_workspace: string }
        Returns: string
      }
      client_zone: {
        Args: { p_client: string; p_workspace: string }
        Returns: string
      }
      coach_last_results: {
        Args: { p_client_id: string; p_exercise_ids: string[] }
        Returns: {
          actual_distance_m: number
          actual_duration_s: number
          actual_reps: number
          actual_weight_kg: number
          exercise_id: string
          finished_at: string
          position: number
          set_type: Database["public"]["Enums"]["set_type"]
        }[]
      }
      coach_meal_log_counts: {
        Args: { p_workspace_id: string }
        Returns: {
          coach_meal_id: string
          logged: number
        }[]
      }
      coach_save_workout_log: {
        Args: { p_client_id: string; p_doc: Json }
        Returns: Json
      }
      community_likes_to_reactions: { Args: never; Returns: undefined }
      copy_client_workout: {
        Args: {
          p_client_id: string
          p_date: string
          p_new_id: string
          p_source: string
        }
        Returns: string
      }
      copy_program_week: {
        Args: {
          p_from: number
          p_ids: string[]
          p_program_id: string
          p_to: number[]
        }
        Returns: {
          day: number
          id: string
          position: number
          week: number
          workout_id: string
        }[]
      }
      copy_workout: {
        Args: {
          p_assignment: string
          p_client: string
          p_date: string
          p_new_id: string
          p_source: string
        }
        Returns: string
      }
      copy_workout_children: {
        Args: { p_source: string; p_target: string }
        Returns: undefined
      }
      correct_workout_log: {
        Args: { p_log_id: string; p_sets: Json }
        Returns: number
      }
      create_community_post: {
        Args: {
          p_body: string
          p_card?: Json
          p_community_id: string
          p_id: string
          p_images?: Json
        }
        Returns: string
      }
      document_path_client: { Args: { name: string }; Returns: string }
      document_path_workspace: { Args: { name: string }; Returns: string }
      duplicate_program: {
        Args: { p_name: string; p_new_id: string; p_program_id: string }
        Returns: string
      }
      exercise_usable_in: { Args: { ex: string; ws: string }; Returns: boolean }
      finish_push_batch: {
        Args: { p_dead_tokens: string[]; p_results: Json }
        Returns: undefined
      }
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
      get_my_coach: {
        Args: never
        Returns: {
          coach_name: string
        }[]
      }
      get_my_coach_profile: {
        Args: never
        Returns: {
          avatar_path: string
          bio: string
          business_name: string
          coach_name: string
          updated_at: string
        }[]
      }
      get_or_create_conversation: {
        Args: { p_client_id: string }
        Returns: string
      }
      hand_back_workout_log: { Args: { p_log_id: string }; Returns: Json }
      has_blocked: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: boolean
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
      is_coach_anywhere: { Args: never; Returns: boolean }
      is_coach_of: { Args: { ws: string }; Returns: boolean }
      is_library_workout_of: {
        Args: { w: string; ws: string }
        Returns: boolean
      }
      is_member_of: { Args: { ws: string }; Returns: boolean }
      is_system_write: { Args: never; Returns: boolean }
      json_number_ok: {
        Args: {
          hi: number
          lo: number
          lo_exclusive?: boolean
          whole: boolean
          x: Json
        }
        Returns: boolean
      }
      last_results: {
        Args: { p_exercise_ids: string[] }
        Returns: {
          actual_distance_m: number
          actual_duration_s: number
          actual_reps: number
          actual_weight_kg: number
          exercise_id: string
          finished_at: string
          position: number
          set_type: Database["public"]["Enums"]["set_type"]
        }[]
      }
      latest_coach_scans: {
        Args: { p_workspace_id: string }
        Returns: {
          client_id: string
          measured_on: string
        }[]
      }
      live_sync_backfill_copies: { Args: never; Returns: number }
      live_sync_program: { Args: { p_program_id: string }; Returns: number }
      lookup_members_by_email: {
        Args: { emails: string[] }
        Returns: {
          email: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }[]
      }
      mark_community_notifications_read: { Args: never; Returns: undefined }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      message_image_conversation: { Args: { p_name: string }; Returns: string }
      my_removal: {
        Args: never
        Returns: {
          removed_at: string
          workspace_name: string
        }[]
      }
      preview_community_card: {
        Args: { p_card: Json; p_community_id: string }
        Returns: Json
      }
      progression_history: {
        Args: { p_exercise_ids: string[]; p_workout_id: string }
        Returns: {
          actual_reps: number
          actual_weight_kg: number
          completed: boolean
          exercise_id: string
          primary_muscles: string[]
          session: number
          set_type: Database["public"]["Enums"]["set_type"]
        }[]
      }
      push_badge_count: { Args: { p_user: string }; Returns: number }
      push_cleanup: { Args: never; Returns: undefined }
      push_dispatch: { Args: { p_job: string }; Returns: undefined }
      push_reminder_candidates: {
        Args: never
        Returns: {
          last_reminder_at: string
          prefs: Json
          time_zone: string
          user_id: string
          workout_count: number
          workout_id: string
          workout_name: string
          workspace_id: string
        }[]
      }
      push_user_context: {
        Args: { p_user_ids: string[] }
        Returns: {
          badge: number
          prefs: Json
          time_zone: string
          tokens: string[]
          user_id: string
        }[]
      }
      queue_live_sync: { Args: { p_program_id: string }; Returns: undefined }
      recent_exercises_for_client: {
        Args: { p_limit?: number }
        Returns: {
          exercise_id: string
          last_used: string
        }[]
      }
      recent_exercises_for_coach: {
        Args: { p_limit?: number }
        Returns: {
          exercise_id: string
          last_used: string
        }[]
      }
      reclaim_workout_log: { Args: { p_log_id: string }; Returns: Json }
      register_push_device: {
        Args: { p_app_version: string; p_token: string }
        Returns: undefined
      }
      remove_client: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: undefined
      }
      remove_community_member: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: undefined
      }
      report_community_content: {
        Args: {
          p_comment_id?: string
          p_note?: string
          p_post_id?: string
          p_reason: string
        }
        Returns: string
      }
      resolve_community_report: {
        Args: { p_report_id: string; p_resolution: string }
        Returns: undefined
      }
      restore_community_member: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: undefined
      }
      save_body_measurement: { Args: { p: Json }; Returns: string }
      save_workout: {
        Args: { p_doc: Json; p_workspace_id: string }
        Returns: string
      }
      save_workout_log: { Args: { p_doc: Json }; Returns: Json }
      scan_path_client: { Args: { name: string }; Returns: string }
      scan_path_workspace: { Args: { name: string }; Returns: string }
      schedule_workout: {
        Args: {
          p_client_id: string
          p_date: string
          p_new_id: string
          p_workout_id: string
        }
        Returns: string
      }
      set_community_post_pinned: {
        Args: { p_pinned: boolean; p_post_id: string }
        Returns: undefined
      }
      set_invite_plan: {
        Args: {
          p_invite_id: string
          p_program_id?: string
          p_start_on?: string
          p_workout_days?: string[]
          p_workout_ids?: string[]
        }
        Returns: number
      }
      set_nutrition_targets: {
        Args: {
          p_calories: number
          p_carbs_g: number
          p_client_id: string
          p_fat_g: number
          p_protein_g: number
          p_workspace_id: string
        }
        Returns: undefined
      }
      set_program_weeks: {
        Args: { p_program_id: string; p_weeks: number }
        Returns: number
      }
      shares_workspace_with: { Args: { other: string }; Returns: boolean }
      split_full_name: { Args: { name: string }; Returns: string[] }
      storage_objects_for_user: {
        Args: { p_user: string }
        Returns: {
          bucket_id: string
          name: string
        }[]
      }
      take_over_workout_log: { Args: { p_log_id: string }; Returns: Json }
      unassign_program: {
        Args: { p_assignment_id: string; p_from_date: string }
        Returns: number
      }
      unregister_push_device: { Args: { p_token: string }; Returns: undefined }
      update_workspace_name: { Args: { p_name: string }; Returns: undefined }
      uuid_text_ok: { Args: { t: string }; Returns: boolean }
      valid_substitute_set: { Args: { v: Json }; Returns: boolean }
      valid_substitute_sets: { Args: { p_sets: Json }; Returns: boolean }
      workout_content_hash: { Args: { p_workout: string }; Returns: string }
      workout_is_done: { Args: { p_workout_id: string }; Returns: boolean }
      workout_log_logger: { Args: { p_log_id: string }; Returns: Json }
    }
    Enums: {
      admin_role: "readonly" | "support" | "owner"
      block_kind: "straight" | "superset" | "choice"
      log_status: "in_progress" | "completed" | "discarded"
      member_role: "owner" | "staff" | "client"
      set_type: "normal" | "warmup" | "drop"
      tracking_type:
        | "weight_reps"
        | "reps"
        | "time"
        | "distance"
        | "weight_time"
        | "weight"
        | "reps_time"
        | "weight_reps_time"
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
      admin_role: ["readonly", "support", "owner"],
      block_kind: ["straight", "superset", "choice"],
      log_status: ["in_progress", "completed", "discarded"],
      member_role: ["owner", "staff", "client"],
      set_type: ["normal", "warmup", "drop"],
      tracking_type: [
        "weight_reps",
        "reps",
        "time",
        "distance",
        "weight_time",
        "weight",
        "reps_time",
        "weight_reps_time",
      ],
    },
  },
} as const


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
      app_release: {
        Row: {
          checksum: string | null
          id: string
          notes: string | null
          object_path: string
          published_at: string
          session_key: string | null
          version: string
        }
        Insert: {
          checksum?: string | null
          id?: string
          notes?: string | null
          object_path: string
          published_at?: string
          session_key?: string | null
          version: string
        }
        Update: {
          checksum?: string | null
          id?: string
          notes?: string | null
          object_path?: string
          published_at?: string
          session_key?: string | null
          version?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          available: boolean
          category_id: string
          description: string
          discount: number | null
          id: string
          image: string | null
          name: string
          price: number
          removable_ingredients: string[] | null
          rodizio_available: boolean | null
          tags: string[] | null
          vat_rate: number | null
        }
        Insert: {
          available: boolean
          category_id: string
          description: string
          discount?: number | null
          id?: string
          image?: string | null
          name: string
          price: number
          removable_ingredients?: string[] | null
          rodizio_available?: boolean | null
          tags?: string[] | null
          vat_rate?: number | null
        }
        Update: {
          available?: boolean
          category_id?: string
          description?: string
          discount?: number | null
          id?: string
          image?: string | null
          name?: string
          price?: number
          removable_ingredients?: string[] | null
          rodizio_available?: boolean | null
          tags?: string[] | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          discount_type: string | null
          discount_value: number | null
          entry_price: number | null
          headcount: number | null
          id: string
          items: Json
          mode: string | null
          request_id: string
          session_id: string | null
          source: string
          status: string
          table_number: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at: string
          discount_type?: string | null
          discount_value?: number | null
          entry_price?: number | null
          headcount?: number | null
          id: string
          items: Json
          mode?: string | null
          request_id: string
          session_id?: string | null
          source: string
          status: string
          table_number: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          discount_type?: string | null
          discount_value?: number | null
          entry_price?: number | null
          headcount?: number | null
          id?: string
          items?: Json
          mode?: string | null
          request_id?: string
          session_id?: string | null
          source?: string
          status?: string
          table_number?: number
        }
        Relationships: []
      }
      payments: {
        Row: {
          account_closed_at: string | null
          account_entry_price: number | null
          account_headcount: number | null
          account_mode: string | null
          account_opened_at: string | null
          amount: number
          created_at: string
          created_by: string
          id: string
          method: string
          session_id: string | null
          shift_id: string | null
          table_number: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          account_closed_at?: string | null
          account_entry_price?: number | null
          account_headcount?: number | null
          account_mode?: string | null
          account_opened_at?: string | null
          amount: number
          created_at: string
          created_by: string
          id?: string
          method: string
          session_id?: string | null
          shift_id?: string | null
          table_number: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          account_closed_at?: string | null
          account_entry_price?: number | null
          account_headcount?: number | null
          account_mode?: string | null
          account_opened_at?: string | null
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          method?: string
          session_id?: string | null
          shift_id?: string | null
          table_number?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          role: string
          table_number: number | null
          username: string
        }
        Insert: {
          active?: boolean
          created_at: string
          id: string
          role: string
          table_number?: number | null
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          role?: string
          table_number?: number | null
          username?: string
        }
        Relationships: []
      }
      service_calls: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          resolved_at: string | null
          resolved_by: string | null
          session_id: string | null
          status: string
          table_number: number
          type: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at: string
          id: string
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          status?: string
          table_number: number
          type: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          status?: string
          table_number?: number
          type?: string
        }
        Relationships: []
      }
      session_clients: {
        Row: {
          created_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_clients_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_code_attempts: {
        Row: {
          failed_count: number
          last_failed_at: string | null
          locked_until: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          failed_count?: number
          last_failed_at?: string | null
          locked_until?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          failed_count?: number
          last_failed_at?: string | null
          locked_until?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_code_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_code_locks: {
        Row: {
          failed_count: number
          last_failed_at: string | null
          locked_until: string | null
          session_id: string
        }
        Insert: {
          failed_count?: number
          last_failed_at?: string | null
          locked_until?: string | null
          session_id: string
        }
        Update: {
          failed_count?: number
          last_failed_at?: string | null
          locked_until?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_code_locks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          access_code_hash: string | null
          created_at: string
          entry_price: number | null
          expires_at: string | null
          has_access_code: boolean | null
          headcount: number | null
          id: string
          mode: string | null
          open: boolean | null
          opened_at: string | null
          table_number: number
        }
        Insert: {
          access_code_hash?: string | null
          created_at: string
          entry_price?: number | null
          expires_at?: string | null
          has_access_code?: boolean | null
          headcount?: number | null
          id: string
          mode?: string | null
          open?: boolean | null
          opened_at?: string | null
          table_number: number
        }
        Update: {
          access_code_hash?: string | null
          created_at?: string
          entry_price?: number | null
          expires_at?: string | null
          has_access_code?: boolean | null
          headcount?: number | null
          id?: string
          mode?: string | null
          open?: boolean | null
          opened_at?: string | null
          table_number?: number
        }
        Relationships: []
      }
      settings: {
        Row: {
          address: string | null
          default_vat_rate: number | null
          entry_price: number
          id: string
          max_shift_hours: number | null
          mode: string
          name: string | null
          nif: string | null
        }
        Insert: {
          address?: string | null
          default_vat_rate?: number | null
          entry_price: number
          id?: string
          max_shift_hours?: number | null
          mode: string
          name?: string | null
          nif?: string | null
        }
        Update: {
          address?: string | null
          default_vat_rate?: number | null
          entry_price?: number
          id?: string
          max_shift_hours?: number | null
          mode?: string
          name?: string | null
          nif?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          auto_closed: boolean
          closed_at: string | null
          closed_by: string | null
          id: string
          opened_at: string
          opened_by: string
          status: string
        }
        Insert: {
          auto_closed?: boolean
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at: string
          opened_by: string
          status: string
        }
        Update: {
          auto_closed?: boolean
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at?: string
          opened_by?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_user_password: {
        Args: { p_password: string; p_user_id: string }
        Returns: undefined
      }
      bootstrap_first_admin: {
        Args: { p_username: string }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      claim_session_with_code: {
        Args: { p_code_hash: string; p_session_id: string }
        Returns: {
          failed_count: number
          locked_until: string
          ok: boolean
          reason: string
        }[]
      }
      close_stale_shifts: { Args: never; Returns: number }
      get_customer_open_session: {
        Args: never
        Returns: {
          code_failed_attempts: number
          code_locked_until: string
          created_at: string
          entry_price: number
          expires_at: string
          has_access_code: boolean
          headcount: number
          id: string
          mode: string
          open: boolean
          opened_at: string
          table_number: number
        }[]
      }
      get_public_session: {
        Args: { session_id: string }
        Returns: {
          code_failed_attempts: number
          code_locked_until: string
          created_at: string
          entry_price: number
          expires_at: string
          has_access_code: boolean
          headcount: number
          id: string
          mode: string
          open: boolean
          opened_at: string
          table_number: number
        }[]
      }
      has_open_shift: { Args: { p_uid: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_anon: { Args: never; Returns: boolean }
      is_cliente: { Args: never; Returns: boolean }
      is_cozinha: { Args: never; Returns: boolean }
      is_current_session_order: {
        Args: { created_at: string; session_id: string }
        Returns: boolean
      }
      is_customer_table_session: {
        Args: { session_id: string }
        Returns: boolean
      }
      is_empregado: { Args: never; Returns: boolean }
      is_floor_staff: { Args: never; Returns: boolean }
      is_gerente: { Args: never; Returns: boolean }
      is_manageable_staff_role: { Args: { role: string }; Returns: boolean }
      is_session_client: { Args: { session_id: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      now_iso: { Args: never; Returns: string }
      operational_shift_ok: { Args: never; Returns: boolean }
      profile_role: { Args: never; Returns: string }
      profile_table_number: { Args: never; Returns: number }
      reset_session_access_code: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      set_session_headcount: {
        Args: { p_headcount: number; p_session_id: string }
        Returns: undefined
      }
      system_needs_setup: { Args: never; Returns: boolean }
      void_payment: {
        Args: { p_action?: string; p_payment_id: string; p_reason: string }
        Returns: {
          action: string
          ok: boolean
          reopened: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const


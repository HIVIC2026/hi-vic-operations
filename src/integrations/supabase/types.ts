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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assessments: {
        Row: {
          access_difficulty:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          assessed_on: string | null
          assessor_id: string | null
          completed_at: string | null
          created_at: string
          downlights_qty: number | null
          downlights_type: string | null
          downlights_upgrade_qty: number | null
          exhaust_fans_clearance_qty: number | null
          exhaust_fans_qty: number | null
          existing_r_value: number | null
          external_mitti_id: string | null
          hazards: string | null
          id: string
          insulation_present: boolean | null
          job_id: string
          life_support_confirmed: boolean | null
          measured_area_m2: number | null
          mitti_assignee_email: string | null
          mitti_assignee_user_id: string | null
          mitti_completed: boolean
          mitti_created_at: string | null
          mitti_last_error: string | null
          mitti_modified_at: string | null
          mitti_prefill_count: number | null
          mitti_raw_snapshot: Json | null
          mitti_scope: string | null
          mitti_sync_status: Database["public"]["Enums"]["sync_status"]
          mitti_synced_at: string | null
          mitti_template_id: string | null
          mitti_validation_issues: Json
          notes: string | null
          piesa_outcome: Database["public"]["Enums"]["pass_fail"]
          rcds_present: boolean | null
          rcds_required_qty: number | null
          removal_m2: number | null
          removal_required: boolean | null
          status: string
          switchboard_condition: string | null
          updated_at: string
        }
        Insert: {
          access_difficulty?:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          assessed_on?: string | null
          assessor_id?: string | null
          completed_at?: string | null
          created_at?: string
          downlights_qty?: number | null
          downlights_type?: string | null
          downlights_upgrade_qty?: number | null
          exhaust_fans_clearance_qty?: number | null
          exhaust_fans_qty?: number | null
          existing_r_value?: number | null
          external_mitti_id?: string | null
          hazards?: string | null
          id?: string
          insulation_present?: boolean | null
          job_id: string
          life_support_confirmed?: boolean | null
          measured_area_m2?: number | null
          mitti_assignee_email?: string | null
          mitti_assignee_user_id?: string | null
          mitti_completed?: boolean
          mitti_created_at?: string | null
          mitti_last_error?: string | null
          mitti_modified_at?: string | null
          mitti_prefill_count?: number | null
          mitti_raw_snapshot?: Json | null
          mitti_scope?: string | null
          mitti_sync_status?: Database["public"]["Enums"]["sync_status"]
          mitti_synced_at?: string | null
          mitti_template_id?: string | null
          mitti_validation_issues?: Json
          notes?: string | null
          piesa_outcome?: Database["public"]["Enums"]["pass_fail"]
          rcds_present?: boolean | null
          rcds_required_qty?: number | null
          removal_m2?: number | null
          removal_required?: boolean | null
          status?: string
          switchboard_condition?: string | null
          updated_at?: string
        }
        Update: {
          access_difficulty?:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          assessed_on?: string | null
          assessor_id?: string | null
          completed_at?: string | null
          created_at?: string
          downlights_qty?: number | null
          downlights_type?: string | null
          downlights_upgrade_qty?: number | null
          exhaust_fans_clearance_qty?: number | null
          exhaust_fans_qty?: number | null
          existing_r_value?: number | null
          external_mitti_id?: string | null
          hazards?: string | null
          id?: string
          insulation_present?: boolean | null
          job_id?: string
          life_support_confirmed?: boolean | null
          measured_area_m2?: number | null
          mitti_assignee_email?: string | null
          mitti_assignee_user_id?: string | null
          mitti_completed?: boolean
          mitti_created_at?: string | null
          mitti_last_error?: string | null
          mitti_modified_at?: string | null
          mitti_prefill_count?: number | null
          mitti_raw_snapshot?: Json | null
          mitti_scope?: string | null
          mitti_sync_status?: Database["public"]["Enums"]["sync_status"]
          mitti_synced_at?: string | null
          mitti_template_id?: string | null
          mitti_validation_issues?: Json
          notes?: string | null
          piesa_outcome?: Database["public"]["Enums"]["pass_fail"]
          rcds_present?: boolean | null
          rcds_required_qty?: number | null
          removal_m2?: number | null
          removal_required?: boolean | null
          status?: string
          switchboard_condition?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_assessor_id_fkey"
            columns: ["assessor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "assessments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_variations: {
        Row: {
          assignment_id: string
          id: string
          ip_address: string | null
          job_id: string
          proposed_snapshot: Json
          raised_at: string
          raised_by: string | null
          reasons: Json
          reconfirmed_at: string | null
          reconfirmed_by: string | null
          resume_status: Database["public"]["Enums"]["assignment_status"]
          signature_name: string | null
          snapshot_sha256: string | null
          status: string
          user_agent: string | null
        }
        Insert: {
          assignment_id: string
          id?: string
          ip_address?: string | null
          job_id: string
          proposed_snapshot: Json
          raised_at?: string
          raised_by?: string | null
          reasons: Json
          reconfirmed_at?: string | null
          reconfirmed_by?: string | null
          resume_status: Database["public"]["Enums"]["assignment_status"]
          signature_name?: string | null
          snapshot_sha256?: string | null
          status?: string
          user_agent?: string | null
        }
        Update: {
          assignment_id?: string
          id?: string
          ip_address?: string | null
          job_id?: string
          proposed_snapshot?: Json
          raised_at?: string
          raised_by?: string | null
          reasons?: Json
          reconfirmed_at?: string | null
          reconfirmed_by?: string | null
          resume_status?: Database["public"]["Enums"]["assignment_status"]
          signature_name?: string | null
          snapshot_sha256?: string | null
          status?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_variations_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "customer_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_variations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_variations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "assignment_variations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_variations_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_variations_reconfirmed_by_fkey"
            columns: ["reconfirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booked_by: string | null
          contractor_id: string | null
          created_at: string
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["booking_kind"]
          notes: string | null
          scheduled_end: string | null
          scheduled_start: string
          status: Database["public"]["Enums"]["booking_status"]
        }
        Insert: {
          booked_by?: string | null
          contractor_id?: string | null
          created_at?: string
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["booking_kind"]
          notes?: string | null
          scheduled_end?: string | null
          scheduled_start: string
          status?: Database["public"]["Enums"]["booking_status"]
        }
        Update: {
          booked_by?: string | null
          contractor_id?: string | null
          created_at?: string
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["booking_kind"]
          notes?: string | null
          scheduled_end?: string | null
          scheduled_start?: string
          status?: Database["public"]["Enums"]["booking_status"]
        }
        Relationships: [
          {
            foreignKeyName: "bookings_booked_by_fkey"
            columns: ["booked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          abn: string | null
          business_type: Database["public"]["Enums"]["business_type"]
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          licence_number: string | null
          name: string
          phone: string | null
        }
        Insert: {
          abn?: string | null
          business_type: Database["public"]["Enums"]["business_type"]
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          licence_number?: string | null
          name: string
          phone?: string | null
        }
        Update: {
          abn?: string | null
          business_type?: Database["public"]["Enums"]["business_type"]
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          licence_number?: string | null
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      ceiling_measurements: {
        Row: {
          access_difficulty:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          evidence_notes: string | null
          existing_r_value: number | null
          external_id: string | null
          external_source: string | null
          id: string
          insulation_present: boolean | null
          is_current: boolean
          job_id: string
          measured_area_m2: number | null
          raw_snapshot: Json | null
          removal_m2: number | null
          removal_required: boolean | null
          review_flags: Json
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_role: Database["public"]["Enums"]["measurement_source"]
          status: Database["public"]["Enums"]["measurement_status"]
          supplemented_at: string | null
          supplemented_by: string | null
          supplemented_fields: Json
          updated_at: string
        }
        Insert: {
          access_difficulty?:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence_notes?: string | null
          existing_r_value?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          insulation_present?: boolean | null
          is_current?: boolean
          job_id: string
          measured_area_m2?: number | null
          raw_snapshot?: Json | null
          removal_m2?: number | null
          removal_required?: boolean | null
          review_flags?: Json
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_role: Database["public"]["Enums"]["measurement_source"]
          status?: Database["public"]["Enums"]["measurement_status"]
          supplemented_at?: string | null
          supplemented_by?: string | null
          supplemented_fields?: Json
          updated_at?: string
        }
        Update: {
          access_difficulty?:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence_notes?: string | null
          existing_r_value?: number | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          insulation_present?: boolean | null
          is_current?: boolean
          job_id?: string
          measured_area_m2?: number | null
          raw_snapshot?: Json | null
          removal_m2?: number | null
          removal_required?: boolean | null
          review_flags?: Json
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_role?: Database["public"]["Enums"]["measurement_source"]
          status?: Database["public"]["Enums"]["measurement_status"]
          supplemented_at?: string | null
          supplemented_by?: string | null
          supplemented_fields?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ceiling_measurements_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ceiling_measurements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ceiling_measurements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ceiling_measurements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "ceiling_measurements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ceiling_measurements_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ceiling_measurements_supplemented_by_fkey"
            columns: ["supplemented_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_checks: {
        Row: {
          blocking: boolean
          check_key: string
          checked_at: string | null
          checked_by: string | null
          id: string
          job_id: string
          label: string
          notes: string | null
          sort: number
          status: Database["public"]["Enums"]["pass_fail"]
        }
        Insert: {
          blocking?: boolean
          check_key: string
          checked_at?: string | null
          checked_by?: string | null
          id?: string
          job_id: string
          label: string
          notes?: string | null
          sort?: number
          status?: Database["public"]["Enums"]["pass_fail"]
        }
        Update: {
          blocking?: boolean
          check_key?: string
          checked_at?: string | null
          checked_by?: string | null
          id?: string
          job_id?: string
          label?: string
          notes?: string | null
          sort?: number
          status?: Database["public"]["Enums"]["pass_fail"]
        }
        Relationships: [
          {
            foreignKeyName: "compliance_checks_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "compliance_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_templates: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          body: string
          created_at: string
          created_by: string | null
          form_fields: Json
          id: string
          is_active: boolean
          required: boolean
          source_note: string | null
          template_key: string
          version: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          form_fields?: Json
          id?: string
          is_active?: boolean
          required?: boolean
          source_note?: string | null
          template_key: string
          version: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          form_fields?: Json
          id?: string
          is_active?: boolean
          required?: boolean
          source_note?: string | null
          template_key?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_templates_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_agreements: {
        Row: {
          agreement_wording_version: string | null
          ap_legal_entity: string
          assistance_requirement:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          consumer_rights_version: string | null
          copy_path: string | null
          created_at: string
          final_customer_price_inc_gst: number
          id: string
          installer_business_id: string | null
          installer_business_name: string | null
          installer_name: string | null
          installer_user_id: string | null
          ip: string | null
          job_id: string
          payment_terms: string | null
          price_before_benefit_inc_gst: number
          property_address: string | null
          quote_id: string
          quote_version: number
          quoted_area_m2: number | null
          quoted_product: string | null
          record_origin: string
          rectification_scope: Json
          retain_until: string | null
          signatory_authority_type: string
          signatory_email: string | null
          signatory_name: string
          signatory_over_18: boolean
          signatory_phone: string | null
          signature_name: string
          signed_at: string
          signed_by: string | null
          snapshot: Json
          snapshot_sha256: string
          status: string
          user_agent: string | null
          veu_benefit_inc_gst: number
        }
        Insert: {
          agreement_wording_version?: string | null
          ap_legal_entity: string
          assistance_requirement?:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          consumer_rights_version?: string | null
          copy_path?: string | null
          created_at?: string
          final_customer_price_inc_gst: number
          id?: string
          installer_business_id?: string | null
          installer_business_name?: string | null
          installer_name?: string | null
          installer_user_id?: string | null
          ip?: string | null
          job_id: string
          payment_terms?: string | null
          price_before_benefit_inc_gst: number
          property_address?: string | null
          quote_id: string
          quote_version: number
          quoted_area_m2?: number | null
          quoted_product?: string | null
          record_origin?: string
          rectification_scope?: Json
          retain_until?: string | null
          signatory_authority_type: string
          signatory_email?: string | null
          signatory_name: string
          signatory_over_18?: boolean
          signatory_phone?: string | null
          signature_name: string
          signed_at: string
          signed_by?: string | null
          snapshot: Json
          snapshot_sha256: string
          status?: string
          user_agent?: string | null
          veu_benefit_inc_gst: number
        }
        Update: {
          agreement_wording_version?: string | null
          ap_legal_entity?: string
          assistance_requirement?:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          consumer_rights_version?: string | null
          copy_path?: string | null
          created_at?: string
          final_customer_price_inc_gst?: number
          id?: string
          installer_business_id?: string | null
          installer_business_name?: string | null
          installer_name?: string | null
          installer_user_id?: string | null
          ip?: string | null
          job_id?: string
          payment_terms?: string | null
          price_before_benefit_inc_gst?: number
          property_address?: string | null
          quote_id?: string
          quote_version?: number
          quoted_area_m2?: number | null
          quoted_product?: string | null
          record_origin?: string
          rectification_scope?: Json
          retain_until?: string | null
          signatory_authority_type?: string
          signatory_email?: string | null
          signatory_name?: string
          signatory_over_18?: boolean
          signatory_phone?: string | null
          signature_name?: string
          signed_at?: string
          signed_by?: string | null
          snapshot?: Json
          snapshot_sha256?: string
          status?: string
          user_agent?: string | null
          veu_benefit_inc_gst?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_agreements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_agreements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_agreements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_agreements_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_agreements_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_assignments: {
        Row: {
          ap_declaration_version: string | null
          ap_details: Json
          ap_legal_entity: string
          ap_signature_name: string | null
          ap_signed_at: string | null
          ap_signed_by: string | null
          ap_snapshot_sha256: string | null
          assistance_requirement:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          consumer_copy_path: string | null
          consumer_declaration_version: string | null
          consumer_ip: string | null
          consumer_rights_version: string | null
          consumer_signature_name: string | null
          consumer_signed_at: string | null
          consumer_signed_by: string | null
          consumer_snapshot: Json | null
          consumer_snapshot_sha256: string | null
          consumer_user_agent: string | null
          copy_sent_at: string | null
          created_at: string
          customer_agreement_id: string | null
          delivery_status: string
          effective_at: string | null
          esc_consent_signed_at: string | null
          esc_consent_version: string | null
          final_copy_at: string | null
          final_copy_path: string | null
          final_customer_price_inc_gst: number | null
          final_facts: Json | null
          final_facts_sha256: string | null
          id: string
          installed_area_m2: number | null
          installed_product: string | null
          installed_r_value: string | null
          installer_abn: string | null
          installer_business_id: string | null
          installer_business_name: string | null
          installer_declaration_id: string | null
          installer_declaration_version: string | null
          installer_form_values: Json | null
          installer_ip: string | null
          installer_licence: string | null
          installer_name: string | null
          installer_signature_name: string | null
          installer_signed_at: string | null
          installer_snapshot: Json | null
          installer_snapshot_sha256: string | null
          installer_user_agent: string | null
          installer_user_id: string | null
          job_id: string
          prepared_at: string | null
          price_before_benefit_inc_gst: number | null
          quote_id: string
          quote_version: number
          quoted_area_m2: number | null
          quoted_product: string | null
          record_kind: string
          retain_until: string | null
          signatory_authority_type: string | null
          signatory_email: string | null
          signatory_name: string | null
          signatory_over_18: boolean | null
          signatory_phone: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          updated_at: string
          variation_reasons: Json
          veu_benefit_inc_gst: number | null
        }
        Insert: {
          ap_declaration_version?: string | null
          ap_details?: Json
          ap_legal_entity: string
          ap_signature_name?: string | null
          ap_signed_at?: string | null
          ap_signed_by?: string | null
          ap_snapshot_sha256?: string | null
          assistance_requirement?:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          consumer_copy_path?: string | null
          consumer_declaration_version?: string | null
          consumer_ip?: string | null
          consumer_rights_version?: string | null
          consumer_signature_name?: string | null
          consumer_signed_at?: string | null
          consumer_signed_by?: string | null
          consumer_snapshot?: Json | null
          consumer_snapshot_sha256?: string | null
          consumer_user_agent?: string | null
          copy_sent_at?: string | null
          created_at?: string
          customer_agreement_id?: string | null
          delivery_status?: string
          effective_at?: string | null
          esc_consent_signed_at?: string | null
          esc_consent_version?: string | null
          final_copy_at?: string | null
          final_copy_path?: string | null
          final_customer_price_inc_gst?: number | null
          final_facts?: Json | null
          final_facts_sha256?: string | null
          id?: string
          installed_area_m2?: number | null
          installed_product?: string | null
          installed_r_value?: string | null
          installer_abn?: string | null
          installer_business_id?: string | null
          installer_business_name?: string | null
          installer_declaration_id?: string | null
          installer_declaration_version?: string | null
          installer_form_values?: Json | null
          installer_ip?: string | null
          installer_licence?: string | null
          installer_name?: string | null
          installer_signature_name?: string | null
          installer_signed_at?: string | null
          installer_snapshot?: Json | null
          installer_snapshot_sha256?: string | null
          installer_user_agent?: string | null
          installer_user_id?: string | null
          job_id: string
          prepared_at?: string | null
          price_before_benefit_inc_gst?: number | null
          quote_id: string
          quote_version: number
          quoted_area_m2?: number | null
          quoted_product?: string | null
          record_kind?: string
          retain_until?: string | null
          signatory_authority_type?: string | null
          signatory_email?: string | null
          signatory_name?: string | null
          signatory_over_18?: boolean | null
          signatory_phone?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
          variation_reasons?: Json
          veu_benefit_inc_gst?: number | null
        }
        Update: {
          ap_declaration_version?: string | null
          ap_details?: Json
          ap_legal_entity?: string
          ap_signature_name?: string | null
          ap_signed_at?: string | null
          ap_signed_by?: string | null
          ap_snapshot_sha256?: string | null
          assistance_requirement?:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          consumer_copy_path?: string | null
          consumer_declaration_version?: string | null
          consumer_ip?: string | null
          consumer_rights_version?: string | null
          consumer_signature_name?: string | null
          consumer_signed_at?: string | null
          consumer_signed_by?: string | null
          consumer_snapshot?: Json | null
          consumer_snapshot_sha256?: string | null
          consumer_user_agent?: string | null
          copy_sent_at?: string | null
          created_at?: string
          customer_agreement_id?: string | null
          delivery_status?: string
          effective_at?: string | null
          esc_consent_signed_at?: string | null
          esc_consent_version?: string | null
          final_copy_at?: string | null
          final_copy_path?: string | null
          final_customer_price_inc_gst?: number | null
          final_facts?: Json | null
          final_facts_sha256?: string | null
          id?: string
          installed_area_m2?: number | null
          installed_product?: string | null
          installed_r_value?: string | null
          installer_abn?: string | null
          installer_business_id?: string | null
          installer_business_name?: string | null
          installer_declaration_id?: string | null
          installer_declaration_version?: string | null
          installer_form_values?: Json | null
          installer_ip?: string | null
          installer_licence?: string | null
          installer_name?: string | null
          installer_signature_name?: string | null
          installer_signed_at?: string | null
          installer_snapshot?: Json | null
          installer_snapshot_sha256?: string | null
          installer_user_agent?: string | null
          installer_user_id?: string | null
          job_id?: string
          prepared_at?: string | null
          price_before_benefit_inc_gst?: number | null
          quote_id?: string
          quote_version?: number
          quoted_area_m2?: number | null
          quoted_product?: string | null
          record_kind?: string
          retain_until?: string | null
          signatory_authority_type?: string | null
          signatory_email?: string | null
          signatory_name?: string | null
          signatory_over_18?: boolean | null
          signatory_phone?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
          variation_reasons?: Json
          veu_benefit_inc_gst?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_assignments_consumer_signed_by_fkey"
            columns: ["consumer_signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_customer_agreement_id_fkey"
            columns: ["customer_agreement_id"]
            isOneToOne: false
            referencedRelation: "customer_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_installer_business_id_fkey"
            columns: ["installer_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_installer_declaration_id_fkey"
            columns: ["installer_declaration_id"]
            isOneToOne: false
            referencedRelation: "installer_declarations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_installer_user_id_fkey"
            columns: ["installer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      declarations: {
        Row: {
          declared_at: string
          declared_by: string | null
          id: string
          job_id: string
          kind: string
          statement: string
        }
        Insert: {
          declared_at?: string
          declared_by?: string | null
          id?: string
          job_id: string
          kind: string
          statement: string
        }
        Update: {
          declared_at?: string
          declared_by?: string | null
          id?: string
          job_id?: string
          kind?: string
          statement?: string
        }
        Relationships: [
          {
            foreignKeyName: "declarations_declared_by_fkey"
            columns: ["declared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          kind: string
          mime_type: string | null
          storage_path: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          kind: string
          mime_type?: string | null
          storage_path: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          kind?: string
          mime_type?: string | null
          storage_path?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esc_notification_config: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          required_fields: Json
          source_note: string | null
          version: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          required_fields?: Json
          source_note?: string | null
          version: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          required_fields?: Json
          source_note?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "esc_notification_config_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_notification_config_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esc_notifications: {
        Row: {
          booking_id: string | null
          config_version: string | null
          consent_assignment_id: string | null
          consent_id: string | null
          consent_signed_at: string | null
          consent_template_version: string | null
          created_at: string
          due_by: string
          earliest_send_at: string | null
          id: string
          installation_days: Json
          job_id: string
          last_error: string | null
          owner_contact: Json
          payload_hash: string | null
          payload_json: Json
          payload_version: string | null
          premises_address: string
          response: Json | null
          scheduled_end: string | null
          scheduled_start: string
          sent_at: string | null
          status: string
          submission_method: string | null
          submission_reference: string | null
          submitted_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          booking_id?: string | null
          config_version?: string | null
          consent_assignment_id?: string | null
          consent_id?: string | null
          consent_signed_at?: string | null
          consent_template_version?: string | null
          created_at?: string
          due_by: string
          earliest_send_at?: string | null
          id?: string
          installation_days?: Json
          job_id: string
          last_error?: string | null
          owner_contact?: Json
          payload_hash?: string | null
          payload_json?: Json
          payload_version?: string | null
          premises_address: string
          response?: Json | null
          scheduled_end?: string | null
          scheduled_start: string
          sent_at?: string | null
          status?: string
          submission_method?: string | null
          submission_reference?: string | null
          submitted_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          booking_id?: string | null
          config_version?: string | null
          consent_assignment_id?: string | null
          consent_id?: string | null
          consent_signed_at?: string | null
          consent_template_version?: string | null
          created_at?: string
          due_by?: string
          earliest_send_at?: string | null
          id?: string
          installation_days?: Json
          job_id?: string
          last_error?: string | null
          owner_contact?: Json
          payload_hash?: string | null
          payload_json?: Json
          payload_version?: string | null
          premises_address?: string
          response?: Json | null
          scheduled_end?: string | null
          scheduled_start?: string
          sent_at?: string | null
          status?: string
          submission_method?: string | null
          submission_reference?: string | null
          submitted_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "esc_notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_notifications_consent_assignment_id_fkey"
            columns: ["consent_assignment_id"]
            isOneToOne: false
            referencedRelation: "customer_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_notifications_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "owner_esc_consents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "esc_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_notifications_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_files: {
        Row: {
          file_name: string
          id: string
          job_id: string
          mime_type: string | null
          requirement_id: string
          size_bytes: number | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_name: string
          id?: string
          job_id: string
          mime_type?: string | null
          requirement_id: string
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string
          id?: string
          job_id?: string
          mime_type?: string | null
          requirement_id?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "evidence_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_files_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "evidence_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_requirements: {
        Row: {
          category: Database["public"]["Enums"]["evidence_category"]
          gate: string
          id: string
          job_id: string
          label: string
          notes: string | null
          required: boolean
          responsible_role:
            | Database["public"]["Enums"]["assignment_role"]
            | null
          sort: number
          status: Database["public"]["Enums"]["evidence_status"]
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["evidence_category"]
          gate: string
          id?: string
          job_id: string
          label: string
          notes?: string | null
          required?: boolean
          responsible_role?:
            | Database["public"]["Enums"]["assignment_role"]
            | null
          sort?: number
          status?: Database["public"]["Enums"]["evidence_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["evidence_category"]
          gate?: string
          id?: string
          job_id?: string
          label?: string
          notes?: string | null
          required?: boolean
          responsible_role?:
            | Database["public"]["Enums"]["assignment_role"]
            | null
          sort?: number
          status?: Database["public"]["Enums"]["evidence_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "evidence_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_requirements_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      external_sync_logs: {
        Row: {
          created_at: string
          direction: string
          entity_id: string | null
          entity_type: string
          error: string | null
          id: string
          payload: Json | null
          status: Database["public"]["Enums"]["sync_status"]
          system: string
        }
        Insert: {
          created_at?: string
          direction: string
          entity_id?: string | null
          entity_type: string
          error?: string | null
          id?: string
          payload?: Json | null
          status: Database["public"]["Enums"]["sync_status"]
          system: string
        }
        Update: {
          created_at?: string
          direction?: string
          entity_id?: string | null
          entity_type?: string
          error?: string | null
          id?: string
          payload?: Json | null
          status?: Database["public"]["Enums"]["sync_status"]
          system?: string
        }
        Relationships: []
      }
      installer_declarations: {
        Row: {
          created_at: string
          field_values: Json
          id: string
          installed_area_m2: number
          installed_product: string
          installed_r_value: string | null
          installer_abn: string | null
          installer_business_id: string | null
          installer_business_name: string | null
          installer_licence: string | null
          installer_name: string | null
          installer_user_id: string | null
          ip: string | null
          job_id: string
          signature_name: string
          signed_at: string
          signed_by: string | null
          snapshot: Json
          snapshot_sha256: string
          status: string
          template_version: string
          user_agent: string | null
          zones: Json
        }
        Insert: {
          created_at?: string
          field_values?: Json
          id?: string
          installed_area_m2: number
          installed_product: string
          installed_r_value?: string | null
          installer_abn?: string | null
          installer_business_id?: string | null
          installer_business_name?: string | null
          installer_licence?: string | null
          installer_name?: string | null
          installer_user_id?: string | null
          ip?: string | null
          job_id: string
          signature_name: string
          signed_at: string
          signed_by?: string | null
          snapshot: Json
          snapshot_sha256: string
          status?: string
          template_version: string
          user_agent?: string | null
          zones?: Json
        }
        Update: {
          created_at?: string
          field_values?: Json
          id?: string
          installed_area_m2?: number
          installed_product?: string
          installed_r_value?: string | null
          installer_abn?: string | null
          installer_business_id?: string | null
          installer_business_name?: string | null
          installer_licence?: string | null
          installer_name?: string | null
          installer_user_id?: string | null
          ip?: string | null
          job_id?: string
          signature_name?: string
          signed_at?: string
          signed_by?: string | null
          snapshot?: Json
          snapshot_sha256?: string
          status?: string
          template_version?: string
          user_agent?: string | null
          zones?: Json
        }
        Relationships: [
          {
            foreignKeyName: "installer_declarations_installer_business_id_fkey"
            columns: ["installer_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installer_declarations_installer_user_id_fkey"
            columns: ["installer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installer_declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installer_declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "installer_declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installer_declarations_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_inc_gst: number | null
          amount_paid: number
          balance_amount: number
          balance_due_date: string | null
          balance_paid_at: string | null
          created_at: string
          deposit_amount: number
          deposit_due_date: string
          deposit_paid_amount: number
          deposit_paid_at: string | null
          deposit_pct: number
          deposit_request_amount: number | null
          deposit_request_pct: number | null
          deposit_request_raised_at: string | null
          deposit_request_raised_by: string | null
          due_date: string | null
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["quote_kind"]
          last_sync_error: string | null
          last_synced_at: string | null
          paid_at: string | null
          part: string
          quote_id: string
          status: Database["public"]["Enums"]["payment_status"]
          sync_lock_at: string | null
          total_inc_gst: number
          total_paid: number
          updated_at: string
          xero_contact_id: string | null
          xero_invoice_id: string | null
          xero_invoice_number: string | null
          xero_invoice_status: string | null
          xero_online_url: string | null
          xero_reference: string | null
          xero_tracking_option_id: string | null
          xero_update_pending: boolean
        }
        Insert: {
          amount_inc_gst?: number | null
          amount_paid?: number
          balance_amount: number
          balance_due_date?: string | null
          balance_paid_at?: string | null
          created_at?: string
          deposit_amount: number
          deposit_due_date?: string
          deposit_paid_amount?: number
          deposit_paid_at?: string | null
          deposit_pct?: number
          deposit_request_amount?: number | null
          deposit_request_pct?: number | null
          deposit_request_raised_at?: string | null
          deposit_request_raised_by?: string | null
          due_date?: string | null
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["quote_kind"]
          last_sync_error?: string | null
          last_synced_at?: string | null
          paid_at?: string | null
          part?: string
          quote_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          sync_lock_at?: string | null
          total_inc_gst: number
          total_paid?: number
          updated_at?: string
          xero_contact_id?: string | null
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_invoice_status?: string | null
          xero_online_url?: string | null
          xero_reference?: string | null
          xero_tracking_option_id?: string | null
          xero_update_pending?: boolean
        }
        Update: {
          amount_inc_gst?: number | null
          amount_paid?: number
          balance_amount?: number
          balance_due_date?: string | null
          balance_paid_at?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_due_date?: string
          deposit_paid_amount?: number
          deposit_paid_at?: string | null
          deposit_pct?: number
          deposit_request_amount?: number | null
          deposit_request_pct?: number | null
          deposit_request_raised_at?: string | null
          deposit_request_raised_by?: string | null
          due_date?: string | null
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["quote_kind"]
          last_sync_error?: string | null
          last_synced_at?: string | null
          paid_at?: string | null
          part?: string
          quote_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          sync_lock_at?: string | null
          total_inc_gst?: number
          total_paid?: number
          updated_at?: string
          xero_contact_id?: string | null
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_invoice_status?: string | null
          xero_online_url?: string | null
          xero_reference?: string | null
          xero_tracking_option_id?: string | null
          xero_update_pending?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "invoices_deposit_request_raised_by_fkey"
            columns: ["deposit_request_raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignments: {
        Row: {
          active: boolean
          assigned_at: string
          assigned_by: string | null
          business_id: string | null
          end_reason: string | null
          ended_at: string | null
          id: string
          job_id: string
          role: Database["public"]["Enums"]["assignment_role"]
          user_id: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          business_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          job_id: string
          role: Database["public"]["Enums"]["assignment_role"]
          user_id: string
        }
        Update: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          business_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          job_id?: string
          role?: Database["public"]["Enums"]["assignment_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_communications: {
        Row: {
          attachment_refs: Json
          body: string
          channel: string
          created_at: string
          created_by: string | null
          delivery_status: string
          direction: string
          id: string
          job_id: string
          provider: string
          provider_message_id: string | null
          provider_thread_id: string | null
          received_at: string | null
          recipients: Json
          sender_text: string | null
          sender_user_id: string | null
          sent_at: string | null
          source_event: string | null
          source_reference: string | null
          subject: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          attachment_refs?: Json
          body?: string
          channel: string
          created_at?: string
          created_by?: string | null
          delivery_status?: string
          direction: string
          id?: string
          job_id: string
          provider?: string
          provider_message_id?: string | null
          provider_thread_id?: string | null
          received_at?: string | null
          recipients?: Json
          sender_text?: string | null
          sender_user_id?: string | null
          sent_at?: string | null
          source_event?: string | null
          source_reference?: string | null
          subject?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          attachment_refs?: Json
          body?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          delivery_status?: string
          direction?: string
          id?: string
          job_id?: string
          provider?: string
          provider_message_id?: string | null
          provider_thread_id?: string | null
          received_at?: string | null
          recipients?: Json
          sender_text?: string | null
          sender_user_id?: string | null
          sent_at?: string | null
          source_event?: string | null
          source_reference?: string | null
          subject?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_communications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_communications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_communications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          business_unit: string
          cancelled_reason: string | null
          channel: Database["public"]["Enums"]["job_channel"]
          commercial_model: Database["public"]["Enums"]["commercial_model"]
          commercial_model_set_at: string | null
          commercial_model_set_by: string | null
          created_at: string
          eligibility_decision_rules: Json
          eligibility_decision_source: string | null
          eligibility_outcome:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_reason: string | null
          eligibility_set_at: string | null
          eligibility_set_by: string | null
          estimated_area_m2: number | null
          estimated_area_unknown: boolean
          external_enquiry_id: string | null
          hold_reason: string | null
          id: string
          installation_completed_at: string | null
          job_number: string
          last_activity_at: string
          life_support: boolean
          life_support_status: string | null
          measure_up_responsibility: string
          next_action: string | null
          originating_installer_business_id: string | null
          originating_installer_user_id: string | null
          owner_id: string
          prior_stage: Database["public"]["Enums"]["job_stage"] | null
          property_id: string
          source: string
          stage: Database["public"]["Enums"]["job_stage"]
          updated_at: string
        }
        Insert: {
          business_unit: string
          cancelled_reason?: string | null
          channel?: Database["public"]["Enums"]["job_channel"]
          commercial_model?: Database["public"]["Enums"]["commercial_model"]
          commercial_model_set_at?: string | null
          commercial_model_set_by?: string | null
          created_at?: string
          eligibility_decision_rules?: Json
          eligibility_decision_source?: string | null
          eligibility_outcome?:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_reason?: string | null
          eligibility_set_at?: string | null
          eligibility_set_by?: string | null
          estimated_area_m2?: number | null
          estimated_area_unknown?: boolean
          external_enquiry_id?: string | null
          hold_reason?: string | null
          id?: string
          installation_completed_at?: string | null
          job_number?: string
          last_activity_at?: string
          life_support?: boolean
          life_support_status?: string | null
          measure_up_responsibility?: string
          next_action?: string | null
          originating_installer_business_id?: string | null
          originating_installer_user_id?: string | null
          owner_id: string
          prior_stage?: Database["public"]["Enums"]["job_stage"] | null
          property_id: string
          source?: string
          stage?: Database["public"]["Enums"]["job_stage"]
          updated_at?: string
        }
        Update: {
          business_unit?: string
          cancelled_reason?: string | null
          channel?: Database["public"]["Enums"]["job_channel"]
          commercial_model?: Database["public"]["Enums"]["commercial_model"]
          commercial_model_set_at?: string | null
          commercial_model_set_by?: string | null
          created_at?: string
          eligibility_decision_rules?: Json
          eligibility_decision_source?: string | null
          eligibility_outcome?:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_reason?: string | null
          eligibility_set_at?: string | null
          eligibility_set_by?: string | null
          estimated_area_m2?: number | null
          estimated_area_unknown?: boolean
          external_enquiry_id?: string | null
          hold_reason?: string | null
          id?: string
          installation_completed_at?: string | null
          job_number?: string
          last_activity_at?: string
          life_support?: boolean
          life_support_status?: string | null
          measure_up_responsibility?: string
          next_action?: string | null
          originating_installer_business_id?: string | null
          originating_installer_user_id?: string | null
          owner_id?: string
          prior_stage?: Database["public"]["Enums"]["job_stage"] | null
          property_id?: string
          source?: string
          stage?: Database["public"]["Enums"]["job_stage"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_commercial_model_set_by_fkey"
            columns: ["commercial_model_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_eligibility_set_by_fkey"
            columns: ["eligibility_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_originating_installer_business_id_fkey"
            columns: ["originating_installer_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_originating_installer_user_id_fkey"
            columns: ["originating_installer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "jobs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          internal: boolean
          job_id: string
          sender_id: string | null
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          id?: string
          internal?: boolean
          job_id: string
          sender_id?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          internal?: boolean
          job_id?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_authorities: {
        Row: {
          acceptance_method: string | null
          accepted_at: string | null
          accepted_by: string | null
          ap_legal_entity: string
          assistance_requirement:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          confirmed_over_18: boolean | null
          confirmed_owner_or_authorised: boolean | null
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          document_path: string | null
          document_sha256: string | null
          event_ids: string[]
          expired_at: string | null
          expires_at: string | null
          id: string
          ip_address: string | null
          job_id: string
          owner_email: string | null
          owner_full_name: string
          owner_id: string
          owner_phone: string | null
          property_address: string
          property_id: string
          requested_at: string
          requested_by: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope_snapshot: string
          signature_name: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["authority_status"]
          updated_at: string
          user_agent: string | null
          version: number
          viewed_at: string | null
          wording_snapshot: string
          wording_version: string
        }
        Insert: {
          acceptance_method?: string | null
          accepted_at?: string | null
          accepted_by?: string | null
          ap_legal_entity?: string
          assistance_requirement?:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          confirmed_over_18?: boolean | null
          confirmed_owner_or_authorised?: boolean | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          document_path?: string | null
          document_sha256?: string | null
          event_ids?: string[]
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          job_id: string
          owner_email?: string | null
          owner_full_name: string
          owner_id: string
          owner_phone?: string | null
          property_address: string
          property_id: string
          requested_at?: string
          requested_by?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_snapshot: string
          signature_name?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["authority_status"]
          updated_at?: string
          user_agent?: string | null
          version: number
          viewed_at?: string | null
          wording_snapshot: string
          wording_version: string
        }
        Update: {
          acceptance_method?: string | null
          accepted_at?: string | null
          accepted_by?: string | null
          ap_legal_entity?: string
          assistance_requirement?:
            | Database["public"]["Enums"]["assistance_requirement"]
            | null
          confirmed_over_18?: boolean | null
          confirmed_owner_or_authorised?: boolean | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          document_path?: string | null
          document_sha256?: string | null
          event_ids?: string[]
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          job_id?: string
          owner_email?: string | null
          owner_full_name?: string
          owner_id?: string
          owner_phone?: string | null
          property_address?: string
          property_id?: string
          requested_at?: string
          requested_by?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_snapshot?: string
          signature_name?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["authority_status"]
          updated_at?: string
          user_agent?: string | null
          version?: number
          viewed_at?: string | null
          wording_snapshot?: string
          wording_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_authorities_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_authorities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_authorities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "owner_authorities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_authorities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_authorities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_authorities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "owner_authorities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_authorities_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_authorities_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_esc_consents: {
        Row: {
          ap_ip: string | null
          ap_legal_entity: string
          ap_purpose_explained: boolean | null
          ap_rep_name: string | null
          ap_signed_at: string | null
          ap_signed_by: string | null
          ap_user_agent: string | null
          booking_id: string | null
          copy_path: string | null
          created_at: string
          delivery_status: string
          id: string
          installation_days: Json
          job_id: string
          owner_authority_type: string | null
          owner_contact: Json
          owner_ip: string | null
          owner_signatory_name: string | null
          owner_signature_name: string | null
          owner_signed_at: string | null
          owner_signed_by: string | null
          owner_user_agent: string | null
          premises_address: string
          scheduled_end: string | null
          scheduled_start: string
          signed_sha256: string | null
          snapshot: Json
          snapshot_sha256: string
          stale_reason: string | null
          status: string
          template_version: string | null
          updated_at: string
          version: number
        }
        Insert: {
          ap_ip?: string | null
          ap_legal_entity: string
          ap_purpose_explained?: boolean | null
          ap_rep_name?: string | null
          ap_signed_at?: string | null
          ap_signed_by?: string | null
          ap_user_agent?: string | null
          booking_id?: string | null
          copy_path?: string | null
          created_at?: string
          delivery_status?: string
          id?: string
          installation_days?: Json
          job_id: string
          owner_authority_type?: string | null
          owner_contact?: Json
          owner_ip?: string | null
          owner_signatory_name?: string | null
          owner_signature_name?: string | null
          owner_signed_at?: string | null
          owner_signed_by?: string | null
          owner_user_agent?: string | null
          premises_address: string
          scheduled_end?: string | null
          scheduled_start: string
          signed_sha256?: string | null
          snapshot: Json
          snapshot_sha256: string
          stale_reason?: string | null
          status?: string
          template_version?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          ap_ip?: string | null
          ap_legal_entity?: string
          ap_purpose_explained?: boolean | null
          ap_rep_name?: string | null
          ap_signed_at?: string | null
          ap_signed_by?: string | null
          ap_user_agent?: string | null
          booking_id?: string | null
          copy_path?: string | null
          created_at?: string
          delivery_status?: string
          id?: string
          installation_days?: Json
          job_id?: string
          owner_authority_type?: string | null
          owner_contact?: Json
          owner_ip?: string | null
          owner_signatory_name?: string | null
          owner_signature_name?: string | null
          owner_signed_at?: string | null
          owner_signed_by?: string | null
          owner_user_agent?: string | null
          premises_address?: string
          scheduled_end?: string | null
          scheduled_start?: string
          signed_sha256?: string | null
          snapshot?: Json
          snapshot_sha256?: string
          stale_reason?: string | null
          status?: string
          template_version?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "owner_esc_consents_ap_signed_by_fkey"
            columns: ["ap_signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_esc_consents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_esc_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_esc_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "owner_esc_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_esc_consents_owner_signed_by_fkey"
            columns: ["owner_signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owners: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string
          user_id: string | null
          xero_contact_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
          xero_contact_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string | null
          xero_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owners_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_enquiries: {
        Row: {
          approved_at: string | null
          booking_lead_time: string | null
          cii_certification_details: string | null
          cii_certification_status: string | null
          company: string | null
          contacted_at: string | null
          created_at: string
          declined_at: string | null
          email: string | null
          enquiry_type: string
          estimated_piesa_fee_inc_gst: number | null
          estimated_r5_install_rate_per_sqm_inc_gst: number | null
          estimated_return_visit_fee_inc_gst: number | null
          esv_licensed_electricians_confirmed: boolean | null
          external_id: string | null
          id: string
          internal_notes: string | null
          name: string | null
          notes: string | null
          phone: string | null
          property_count: number | null
          raw_payload: Json | null
          rec_registration_number: string | null
          service_areas: string[] | null
          services: string[] | null
          source: string | null
          source_created_at: string | null
          source_status: string | null
          source_system: string
          source_updated_at: string | null
          status: string
          status_changed_by: string | null
          submission_id: string
          updated_at: string
          weekly_capacity: string | null
        }
        Insert: {
          approved_at?: string | null
          booking_lead_time?: string | null
          cii_certification_details?: string | null
          cii_certification_status?: string | null
          company?: string | null
          contacted_at?: string | null
          created_at?: string
          declined_at?: string | null
          email?: string | null
          enquiry_type: string
          estimated_piesa_fee_inc_gst?: number | null
          estimated_r5_install_rate_per_sqm_inc_gst?: number | null
          estimated_return_visit_fee_inc_gst?: number | null
          esv_licensed_electricians_confirmed?: boolean | null
          external_id?: string | null
          id?: string
          internal_notes?: string | null
          name?: string | null
          notes?: string | null
          phone?: string | null
          property_count?: number | null
          raw_payload?: Json | null
          rec_registration_number?: string | null
          service_areas?: string[] | null
          services?: string[] | null
          source?: string | null
          source_created_at?: string | null
          source_status?: string | null
          source_system?: string
          source_updated_at?: string | null
          status?: string
          status_changed_by?: string | null
          submission_id: string
          updated_at?: string
          weekly_capacity?: string | null
        }
        Update: {
          approved_at?: string | null
          booking_lead_time?: string | null
          cii_certification_details?: string | null
          cii_certification_status?: string | null
          company?: string | null
          contacted_at?: string | null
          created_at?: string
          declined_at?: string | null
          email?: string | null
          enquiry_type?: string
          estimated_piesa_fee_inc_gst?: number | null
          estimated_r5_install_rate_per_sqm_inc_gst?: number | null
          estimated_return_visit_fee_inc_gst?: number | null
          esv_licensed_electricians_confirmed?: boolean | null
          external_id?: string | null
          id?: string
          internal_notes?: string | null
          name?: string | null
          notes?: string | null
          phone?: string | null
          property_count?: number | null
          raw_payload?: Json | null
          rec_registration_number?: string | null
          service_areas?: string[] | null
          services?: string[] | null
          source?: string | null
          source_created_at?: string | null
          source_status?: string | null
          source_system?: string
          source_updated_at?: string | null
          status?: string
          status_changed_by?: string | null
          submission_id?: string
          updated_at?: string
          weekly_capacity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_enquiries_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_overrides: {
        Row: {
          after_state: Json | null
          before_state: Json | null
          created_at: string
          gate: string
          id: string
          invoice_id: string
          job_id: string
          overridden_by: string
          reason: string
        }
        Insert: {
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          gate: string
          id?: string
          invoice_id: string
          job_id: string
          overridden_by: string
          reason: string
        }
        Update: {
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          gate?: string
          id?: string
          invoice_id?: string
          job_id?: string
          overridden_by?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_overrides_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_payment_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_overrides_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_overrides_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_overrides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_overrides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "payment_overrides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_overrides_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      piesa_deliveries: {
        Row: {
          created_at: string
          delivered_at: string
          document_id: string | null
          id: string
          job_id: string
          method: string
          notes: string | null
          piesa_record_id: string
          recipient: string
          recorded_by: string | null
        }
        Insert: {
          created_at?: string
          delivered_at: string
          document_id?: string | null
          id?: string
          job_id: string
          method: string
          notes?: string | null
          piesa_record_id: string
          recipient: string
          recorded_by?: string | null
        }
        Update: {
          created_at?: string
          delivered_at?: string
          document_id?: string | null
          id?: string
          job_id?: string
          method?: string
          notes?: string | null
          piesa_record_id?: string
          recipient?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "piesa_deliveries_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "piesa_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_deliveries_piesa_record_id_fkey"
            columns: ["piesa_record_id"]
            isOneToOne: false
            referencedRelation: "piesa_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_deliveries_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      piesa_records: {
        Row: {
          assessment_id: string | null
          completed_date: string
          created_at: string
          external_mitti_id: string | null
          id: string
          is_current: boolean
          job_id: string
          kind: string
          notes: string | null
          outcome: Database["public"]["Enums"]["pass_fail"]
          signed_off_by: string | null
        }
        Insert: {
          assessment_id?: string | null
          completed_date: string
          created_at?: string
          external_mitti_id?: string | null
          id?: string
          is_current?: boolean
          job_id: string
          kind?: string
          notes?: string | null
          outcome: Database["public"]["Enums"]["pass_fail"]
          signed_off_by?: string | null
        }
        Update: {
          assessment_id?: string | null
          completed_date?: string
          created_at?: string
          external_mitti_id?: string | null
          id?: string
          is_current?: boolean
          job_id?: string
          kind?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["pass_fail"]
          signed_off_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "piesa_records_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "piesa_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_records_signed_off_by_fkey"
            columns: ["signed_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          access_loadings: Json
          ap_fee_ex_gst: number
          ap_margin_pct: number
          created_at: string
          effective_from: string
          gst_rate: number
          id: string
          installer_option_codes: string[]
          is_active: boolean
          veec_credit_per_m2_inc_gst: number
          version: number
        }
        Insert: {
          access_loadings?: Json
          ap_fee_ex_gst?: number
          ap_margin_pct?: number
          created_at?: string
          effective_from?: string
          gst_rate?: number
          id?: string
          installer_option_codes?: string[]
          is_active?: boolean
          veec_credit_per_m2_inc_gst?: number
          version: number
        }
        Update: {
          access_loadings?: Json
          ap_fee_ex_gst?: number
          ap_margin_pct?: number
          created_at?: string
          effective_from?: string
          gst_rate?: number
          id?: string
          installer_option_codes?: string[]
          is_active?: boolean
          veec_credit_per_m2_inc_gst?: number
          version?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          business_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          licence_number: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          licence_number?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          licence_number?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address_line: string
          created_at: string
          enrichment: Json
          id: string
          is_residential: boolean | null
          managed_by_business_id: string | null
          occupancy: Database["public"]["Enums"]["occupancy_type"] | null
          owner_id: string
          postcode: string | null
          state: string
          suburb: string | null
          updated_at: string
          year_built: number | null
        }
        Insert: {
          address_line: string
          created_at?: string
          enrichment?: Json
          id?: string
          is_residential?: boolean | null
          managed_by_business_id?: string | null
          occupancy?: Database["public"]["Enums"]["occupancy_type"] | null
          owner_id: string
          postcode?: string | null
          state?: string
          suburb?: string | null
          updated_at?: string
          year_built?: number | null
        }
        Update: {
          address_line?: string
          created_at?: string
          enrichment?: Json
          id?: string
          is_residential?: boolean | null
          managed_by_business_id?: string | null
          occupancy?: Database["public"]["Enums"]["occupancy_type"] | null
          owner_id?: string
          postcode?: string | null
          state?: string
          suburb?: string | null
          updated_at?: string
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_managed_by_business_id_fkey"
            columns: ["managed_by_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "properties_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      property_area_estimates: {
        Row: {
          calculation: Json | null
          confidence: string
          created_at: string
          created_by: string | null
          document_id: string | null
          excluded_m2: number | null
          gross_m2: number | null
          id: string
          is_current: boolean
          job_id: string
          method: string
          net_m2: number | null
          notes: string | null
          property_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string | null
          source_name: string
          source_url: string | null
          tier: string
        }
        Insert: {
          calculation?: Json | null
          confidence: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          excluded_m2?: number | null
          gross_m2?: number | null
          id?: string
          is_current?: boolean
          job_id: string
          method: string
          net_m2?: number | null
          notes?: string | null
          property_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          source_name: string
          source_url?: string | null
          tier: string
        }
        Update: {
          calculation?: Json | null
          confidence?: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          excluded_m2?: number | null
          gross_m2?: number | null
          id?: string
          is_current?: boolean
          job_id?: string
          method?: string
          net_m2?: number | null
          notes?: string | null
          property_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          source_name?: string
          source_url?: string | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_area_estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_area_estimates_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_area_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_area_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "property_area_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_area_estimates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_area_estimates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_area_estimates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_area_estimates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "property_intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      property_facts: {
        Row: {
          check_status: string
          confidence: string
          created_at: string
          evidence_kind: string
          fact_key: string
          id: string
          is_current: boolean
          is_stale: boolean
          job_id: string
          note: string | null
          property_id: string
          raw_hash: string | null
          raw_snapshot: Json | null
          retrieved_at: string
          run_id: string | null
          source_date: string | null
          source_name: string
          source_record_id: string | null
          source_type: string
          source_url: string | null
          superseded_at: string | null
          value: Json
        }
        Insert: {
          check_status?: string
          confidence?: string
          created_at?: string
          evidence_kind?: string
          fact_key: string
          id?: string
          is_current?: boolean
          is_stale?: boolean
          job_id: string
          note?: string | null
          property_id: string
          raw_hash?: string | null
          raw_snapshot?: Json | null
          retrieved_at?: string
          run_id?: string | null
          source_date?: string | null
          source_name: string
          source_record_id?: string | null
          source_type: string
          source_url?: string | null
          superseded_at?: string | null
          value?: Json
        }
        Update: {
          check_status?: string
          confidence?: string
          created_at?: string
          evidence_kind?: string
          fact_key?: string
          id?: string
          is_current?: boolean
          is_stale?: boolean
          job_id?: string
          note?: string | null
          property_id?: string
          raw_hash?: string | null
          raw_snapshot?: Json | null
          retrieved_at?: string
          run_id?: string | null
          source_date?: string | null
          source_name?: string
          source_record_id?: string | null
          source_type?: string
          source_url?: string | null
          superseded_at?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "property_facts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_facts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "property_facts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_facts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_facts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_facts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "property_intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      property_floorplans: {
        Row: {
          captured_date: string | null
          id: string
          is_candidate: boolean
          job_id: string
          metadata: Json | null
          needs_review: boolean
          property_id: string
          provider: string
          provider_image_id: string | null
          provider_property_id: string | null
          provider_url: string | null
          retrieved_at: string
          review_reason: string | null
          run_id: string | null
          storage_path: string | null
          storage_policy: string
        }
        Insert: {
          captured_date?: string | null
          id?: string
          is_candidate?: boolean
          job_id: string
          metadata?: Json | null
          needs_review?: boolean
          property_id: string
          provider: string
          provider_image_id?: string | null
          provider_property_id?: string | null
          provider_url?: string | null
          retrieved_at?: string
          review_reason?: string | null
          run_id?: string | null
          storage_path?: string | null
          storage_policy: string
        }
        Update: {
          captured_date?: string | null
          id?: string
          is_candidate?: boolean
          job_id?: string
          metadata?: Json | null
          needs_review?: boolean
          property_id?: string
          provider?: string
          provider_image_id?: string | null
          provider_property_id?: string | null
          provider_url?: string | null
          retrieved_at?: string
          review_reason?: string | null
          run_id?: string | null
          storage_path?: string | null
          storage_policy?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_floorplans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_floorplans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "property_floorplans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_floorplans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_floorplans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_floorplans_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "property_intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      property_intelligence_runs: {
        Row: {
          address_hash: string | null
          completed_at: string | null
          completeness_pct: number | null
          created_by: string | null
          error_summary: string | null
          id: string
          is_stale: boolean
          job_id: string
          next_action: string | null
          property_id: string
          reference_date: string
          reference_date_basis: string
          result: string | null
          result_reason: string | null
          ruleset_version: string
          stale_reason: string | null
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          address_hash?: string | null
          completed_at?: string | null
          completeness_pct?: number | null
          created_by?: string | null
          error_summary?: string | null
          id?: string
          is_stale?: boolean
          job_id: string
          next_action?: string | null
          property_id: string
          reference_date: string
          reference_date_basis?: string
          result?: string | null
          result_reason?: string | null
          ruleset_version: string
          stale_reason?: string | null
          started_at?: string
          status?: string
          trigger?: string
        }
        Update: {
          address_hash?: string | null
          completed_at?: string | null
          completeness_pct?: number | null
          created_by?: string | null
          error_summary?: string | null
          id?: string
          is_stale?: boolean
          job_id?: string
          next_action?: string | null
          property_id?: string
          reference_date?: string
          reference_date_basis?: string
          result?: string | null
          result_reason?: string | null
          ruleset_version?: string
          stale_reason?: string | null
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_intelligence_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_intelligence_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_intelligence_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "property_intelligence_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_intelligence_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_intelligence_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_source_checks: {
        Row: {
          checked_at: string
          error: string | null
          http_status: number | null
          id: string
          job_id: string
          latency_ms: number | null
          retry_count: number
          run_id: string
          source_key: string
          status: string
        }
        Insert: {
          checked_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          job_id: string
          latency_ms?: number | null
          retry_count?: number
          run_id: string
          source_key: string
          status: string
        }
        Update: {
          checked_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          job_id?: string
          latency_ms?: number | null
          retry_count?: number
          run_id?: string
          source_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_source_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_source_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "property_source_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_source_checks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "property_intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_adjustments: {
        Row: {
          adjusted_by: string
          after_snapshot: Json
          before_snapshot: Json
          created_at: string
          id: string
          quote_id: string
          reason: string
        }
        Insert: {
          adjusted_by: string
          after_snapshot: Json
          before_snapshot: Json
          created_at?: string
          id?: string
          quote_id: string
          reason: string
        }
        Update: {
          adjusted_by?: string
          after_snapshot?: Json
          before_snapshot?: Json
          created_at?: string
          id?: string
          quote_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_adjustments_adjusted_by_fkey"
            columns: ["adjusted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_adjustments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_internals: {
        Row: {
          ap_fee_ex_gst: number
          ap_margin_ex_gst: number
          calc_snapshot: Json
          cost_ex_gst: number
          quote_id: string
        }
        Insert: {
          ap_fee_ex_gst?: number
          ap_margin_ex_gst?: number
          calc_snapshot?: Json
          cost_ex_gst: number
          quote_id: string
        }
        Update: {
          ap_fee_ex_gst?: number
          ap_margin_ex_gst?: number
          calc_snapshot?: Json
          cost_ex_gst?: number
          quote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_internals_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          code: string | null
          description: string
          explanation: string | null
          id: string
          is_other: boolean
          line_total_inc_gst: number
          quantity: number
          quote_id: string
          sort: number
          unit: string
          unit_price_inc_gst: number
        }
        Insert: {
          code?: string | null
          description: string
          explanation?: string | null
          id?: string
          is_other?: boolean
          line_total_inc_gst: number
          quantity: number
          quote_id: string
          sort?: number
          unit: string
          unit_price_inc_gst: number
        }
        Update: {
          code?: string | null
          description?: string
          explanation?: string | null
          id?: string
          is_other?: boolean
          line_total_inc_gst?: number
          quantity?: number
          quote_id?: string
          sort?: number
          unit?: string
          unit_price_inc_gst?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          customer_total_inc_gst: number
          gst_amount: number
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["quote_kind"]
          manually_adjusted: boolean
          option_code: string | null
          option_label: string
          prices_include_gst: boolean
          pricing_settings_id: string | null
          rate_card_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal_inc_gst: number
          veec_discount_inc_gst: number
          version: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_total_inc_gst: number
          gst_amount: number
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["quote_kind"]
          manually_adjusted?: boolean
          option_code?: string | null
          option_label: string
          prices_include_gst?: boolean
          pricing_settings_id?: string | null
          rate_card_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_inc_gst: number
          veec_discount_inc_gst?: number
          version?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_total_inc_gst?: number
          gst_amount?: number
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["quote_kind"]
          manually_adjusted?: boolean
          option_code?: string | null
          option_label?: string
          prices_include_gst?: boolean
          pricing_settings_id?: string | null
          rate_card_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_inc_gst?: number
          veec_discount_inc_gst?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotes_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_pricing_settings_id_fkey"
            columns: ["pricing_settings_id"]
            isOneToOne: false
            referencedRelation: "pricing_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_card_items: {
        Row: {
          category: string
          code: string
          description: string
          id: string
          r_value: number | null
          rate_card_id: string
          sort: number
          unit: string
          unit_price_ex_gst: number
        }
        Insert: {
          category: string
          code: string
          description: string
          id?: string
          r_value?: number | null
          rate_card_id: string
          sort?: number
          unit: string
          unit_price_ex_gst: number
        }
        Update: {
          category?: string
          code?: string
          description?: string
          id?: string
          r_value?: number | null
          rate_card_id?: string
          sort?: number
          unit?: string
          unit_price_ex_gst?: number
        }
        Relationships: [
          {
            foreignKeyName: "rate_card_items_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_cards: {
        Row: {
          business_id: string | null
          created_at: string
          effective_from: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["rate_card_kind"]
          name: string
          version: number
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["rate_card_kind"]
          name: string
          version: number
        }
        Update: {
          business_id?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["rate_card_kind"]
          name?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rate_cards_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      reassignment_requests: {
        Row: {
          created_at: string
          id: string
          job_id: string
          reason: string
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          role: Database["public"]["Enums"]["assignment_role"]
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          reason: string
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          role: Database["public"]["Enums"]["assignment_role"]
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          reason?: string
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          role?: Database["public"]["Enums"]["assignment_role"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reassignment_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reassignment_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "reassignment_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reassignment_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reassignment_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rectification_items: {
        Row: {
          added_by: string | null
          assessment_id: string | null
          created_at: string
          description: string
          explanation: string | null
          external_key: string | null
          id: string
          is_other: boolean
          job_id: string
          needs_office_pricing: boolean
          other_unit_price_inc_gst: number | null
          quantity: number
          rate_code: string | null
          source: string
          status: string
        }
        Insert: {
          added_by?: string | null
          assessment_id?: string | null
          created_at?: string
          description: string
          explanation?: string | null
          external_key?: string | null
          id?: string
          is_other?: boolean
          job_id: string
          needs_office_pricing?: boolean
          other_unit_price_inc_gst?: number | null
          quantity?: number
          rate_code?: string | null
          source?: string
          status?: string
        }
        Update: {
          added_by?: string | null
          assessment_id?: string | null
          created_at?: string
          description?: string
          explanation?: string | null
          external_key?: string | null
          id?: string
          is_other?: boolean
          job_id?: string
          needs_office_pricing?: boolean
          other_unit_price_inc_gst?: number | null
          quantity?: number
          rate_code?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rectification_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rectification_items_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rectification_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rectification_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "rectification_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      veec_lodgements: {
        Row: {
          id: string
          job_id: string
          notes: string | null
          quantity: number | null
          status: string
          submission_reference: string | null
          submitted_date: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          job_id: string
          notes?: string | null
          quantity?: number | null
          status?: string
          submission_reference?: string | null
          submitted_date?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          job_id?: string
          notes?: string | null
          quantity?: number | null
          status?: string
          submission_reference?: string | null
          submitted_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "veec_lodgements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "veec_lodgements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "veec_lodgements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          from_stage: Database["public"]["Enums"]["job_stage"] | null
          id: string
          internal: boolean
          job_id: string
          summary: string
          to_stage: Database["public"]["Enums"]["job_stage"] | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          from_stage?: Database["public"]["Enums"]["job_stage"] | null
          id?: string
          internal?: boolean
          job_id: string
          summary: string
          to_stage?: Database["public"]["Enums"]["job_stage"] | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          from_stage?: Database["public"]["Enums"]["job_stage"] | null
          id?: string
          internal?: boolean
          job_id?: string
          summary?: string
          to_stage?: Database["public"]["Enums"]["job_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "workflow_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_settings: {
        Row: {
          authority_validity_months: number
          customer_comms_enabled: boolean
          id: number
          min_building_age_years: number
          mitti_measureup_template_id: string | null
          piesa_install_window_days: number
          updated_at: string
          urgency_amber_days: number
          urgency_red_days: number
        }
        Insert: {
          authority_validity_months?: number
          customer_comms_enabled?: boolean
          id?: number
          min_building_age_years?: number
          mitti_measureup_template_id?: string | null
          piesa_install_window_days?: number
          updated_at?: string
          urgency_amber_days?: number
          urgency_red_days?: number
        }
        Update: {
          authority_validity_months?: number
          customer_comms_enabled?: boolean
          id?: number
          min_building_age_years?: number
          mitti_measureup_template_id?: string | null
          piesa_install_window_days?: number
          updated_at?: string
          urgency_amber_days?: number
          urgency_red_days?: number
        }
        Relationships: []
      }
    }
    Views: {
      invoice_payment_state: {
        Row: {
          balance_amount: number | null
          balance_due_date: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_cleared: boolean | null
          deposit_due_date: string | null
          deposit_paid_amount: number | null
          deposit_paid_at: string | null
          deposit_pct: number | null
          effective_status: Database["public"]["Enums"]["payment_status"] | null
          id: string | null
          job_id: string | null
          kind: Database["public"]["Enums"]["quote_kind"] | null
          last_sync_error: string | null
          last_synced_at: string | null
          quote_id: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          total_inc_gst: number | null
          total_paid: number | null
          updated_at: string | null
          xero_contact_id: string | null
          xero_invoice_id: string | null
          xero_invoice_number: string | null
          xero_online_url: string | null
          xero_reference: string | null
        }
        Insert: {
          balance_amount?: number | null
          balance_due_date?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_cleared?: never
          deposit_due_date?: string | null
          deposit_paid_amount?: number | null
          deposit_paid_at?: string | null
          deposit_pct?: number | null
          effective_status?: never
          id?: string | null
          job_id?: string | null
          kind?: Database["public"]["Enums"]["quote_kind"] | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          quote_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          total_inc_gst?: number | null
          total_paid?: number | null
          updated_at?: string | null
          xero_contact_id?: string | null
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_online_url?: string | null
          xero_reference?: string | null
        }
        Update: {
          balance_amount?: number | null
          balance_due_date?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_cleared?: never
          deposit_due_date?: string | null
          deposit_paid_amount?: number | null
          deposit_paid_at?: string | null
          deposit_pct?: number | null
          effective_status?: never
          id?: string | null
          job_id?: string | null
          kind?: Database["public"]["Enums"]["quote_kind"] | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          quote_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          total_inc_gst?: number | null
          total_paid?: number | null
          updated_at?: string | null
          xero_contact_id?: string | null
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_online_url?: string | null
          xero_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_status: {
        Row: {
          balance_amount: number | null
          balance_due_date: string | null
          balance_paid_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_cleared: boolean | null
          deposit_due_date: string | null
          deposit_paid_amount: number | null
          deposit_paid_at: string | null
          deposit_pct: number | null
          effective_status: Database["public"]["Enums"]["payment_status"] | null
          id: string | null
          job_id: string | null
          kind: Database["public"]["Enums"]["quote_kind"] | null
          quote_id: string | null
          total_inc_gst: number | null
          total_paid: number | null
          xero_invoice_number: string | null
          xero_online_url: string | null
        }
        Insert: {
          balance_amount?: number | null
          balance_due_date?: string | null
          balance_paid_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_cleared?: never
          deposit_due_date?: string | null
          deposit_paid_amount?: number | null
          deposit_paid_at?: string | null
          deposit_pct?: number | null
          effective_status?: never
          id?: string | null
          job_id?: string | null
          kind?: Database["public"]["Enums"]["quote_kind"] | null
          quote_id?: string | null
          total_inc_gst?: number | null
          total_paid?: number | null
          xero_invoice_number?: string | null
          xero_online_url?: string | null
        }
        Update: {
          balance_amount?: number | null
          balance_due_date?: string | null
          balance_paid_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_cleared?: never
          deposit_due_date?: string | null
          deposit_paid_amount?: number | null
          deposit_paid_at?: string | null
          deposit_pct?: number | null
          effective_status?: never
          id?: string | null
          job_id?: string | null
          kind?: Database["public"]["Enums"]["quote_kind"] | null
          quote_id?: string | null
          total_inc_gst?: number | null
          total_paid?: number | null
          xero_invoice_number?: string | null
          xero_online_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_overview: {
        Row: {
          authority_expires_at: string | null
          authority_status: string | null
          channel: Database["public"]["Enums"]["job_channel"] | null
          commercial_model:
            | Database["public"]["Enums"]["commercial_model"]
            | null
          created_at: string | null
          days_remaining: number | null
          deposit_cleared: boolean | null
          electrician_id: string | null
          electrician_name: string | null
          eligibility_outcome:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          hold_reason: string | null
          id: string | null
          install_deadline: string | null
          installer_id: string | null
          installer_name: string | null
          job_number: string | null
          last_activity_at: string | null
          life_support: boolean | null
          next_action: string | null
          originating_business_name: string | null
          originating_installer_user_id: string | null
          owner_email: string | null
          owner_id: string | null
          owner_name: string | null
          owner_phone: string | null
          payment_status: string | null
          piesa_date: string | null
          piesa_expired: boolean | null
          property_address: string | null
          property_id: string | null
          source: string | null
          stage: Database["public"]["Enums"]["job_stage"] | null
          urgency: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_user_id_fkey"
            columns: ["electrician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_user_id_fkey"
            columns: ["installer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_originating_installer_user_id_fkey"
            columns: ["originating_installer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_piesa_deadlines: {
        Row: {
          days_remaining: number | null
          install_deadline: string | null
          job_id: string | null
          piesa_date: string | null
          piesa_expired: boolean | null
          piesa_outcome: Database["public"]["Enums"]["pass_fail"] | null
          urgency: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_access_job: { Args: { _job: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoice_deposit_cleared: { Args: { _inv: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_job_owner: { Args: { _job: string; _user: string }; Returns: boolean }
      job_assignment_role: {
        Args: { _job: string; _user: string }
        Returns: Database["public"]["Enums"]["assignment_role"]
      }
      job_authority_expires_at: { Args: { _job: string }; Returns: string }
      job_authority_status: { Args: { _job: string }; Returns: string }
      job_deposit_cleared: { Args: { _job: string }; Returns: boolean }
      my_job_role: { Args: { _job: string }; Returns: string }
      shares_job_with: { Args: { _profile: string }; Returns: boolean }
    }
    Enums: {
      access_difficulty: "easy" | "moderate" | "difficult"
      app_role:
        | "admin"
        | "electrician"
        | "installer"
        | "owner"
        | "property_manager"
      assignment_role: "electrician" | "installer" | "property_manager"
      assignment_status:
        | "draft"
        | "consumer_signed_pending_install"
        | "final_details_pending"
        | "installer_signed_pending_install"
        | "variation_required"
        | "effective_complete"
        | "cancelled"
        | "awaiting_installer_signature"
        | "awaiting_ap_signature"
        | "awaiting_consumer_signature"
      assistance_requirement:
        | "none"
        | "interpreter"
        | "support_understanding"
        | "both"
      authority_status:
        | "not_requested"
        | "sent"
        | "viewed"
        | "accepted"
        | "declined"
        | "expired"
        | "revoked"
      booking_kind: "assessment" | "rectification" | "installation"
      booking_status: "proposed" | "confirmed" | "completed" | "cancelled"
      business_type:
        | "accredited_provider"
        | "rec"
        | "eec_installer"
        | "property_manager"
        | "other"
      commercial_model:
        | "hivic_invoices_owner"
        | "installer_invoices_owner"
        | "not_configured"
      eligibility_outcome:
        | "likely_eligible"
        | "needs_onsite_confirmation"
        | "does_not_appear_eligible"
      evidence_category:
        | "measurement"
        | "existing_insulation_r_value"
        | "before_ceiling_space"
        | "access_manhole"
        | "product_evidence"
        | "installation_progress"
        | "completed_installation"
        | "piesa_signoff"
        | "rectification_completion"
        | "installer_declaration"
      evidence_status:
        | "outstanding"
        | "uploaded"
        | "verified"
        | "rejected"
        | "not_required"
      job_channel: "hivic_sourced" | "installer_sourced"
      job_stage:
        | "new_enquiry"
        | "eligibility_review"
        | "awaiting_electrician"
        | "assessment_booking"
        | "assessment_booked"
        | "assessment_complete"
        | "rectification_required"
        | "awaiting_owner_rectification_approval"
        | "awaiting_deposit_payment"
        | "rectification_scheduling"
        | "rectification_booked"
        | "ready_for_installer_quotes"
        | "awaiting_quote_acceptance"
        | "installation_scheduling"
        | "installation_booked"
        | "evidence_outstanding"
        | "ap_review"
        | "ready_for_veec"
        | "complete"
        | "cancelled"
        | "on_hold"
      measurement_source: "electrician" | "installer" | "admin_import"
      measurement_status: "draft" | "needs_review" | "complete" | "rejected"
      occupancy_type: "owner_occupied" | "rental"
      pass_fail: "pending" | "pass" | "fail"
      payment_status:
        | "invoice_not_created"
        | "invoice_created"
        | "deposit_due"
        | "deposit_paid"
        | "balance_due"
        | "fully_paid"
        | "overdue"
        | "xero_sync_error"
      quote_kind: "installation" | "rectification"
      quote_status: "draft" | "issued" | "accepted" | "declined" | "superseded"
      rate_card_kind: "installer" | "electrical"
      sync_status: "not_synced" | "pending" | "synced" | "error"
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
      access_difficulty: ["easy", "moderate", "difficult"],
      app_role: [
        "admin",
        "electrician",
        "installer",
        "owner",
        "property_manager",
      ],
      assignment_role: ["electrician", "installer", "property_manager"],
      assignment_status: [
        "draft",
        "consumer_signed_pending_install",
        "final_details_pending",
        "installer_signed_pending_install",
        "variation_required",
        "effective_complete",
        "cancelled",
        "awaiting_installer_signature",
        "awaiting_ap_signature",
        "awaiting_consumer_signature",
      ],
      assistance_requirement: [
        "none",
        "interpreter",
        "support_understanding",
        "both",
      ],
      authority_status: [
        "not_requested",
        "sent",
        "viewed",
        "accepted",
        "declined",
        "expired",
        "revoked",
      ],
      booking_kind: ["assessment", "rectification", "installation"],
      booking_status: ["proposed", "confirmed", "completed", "cancelled"],
      business_type: [
        "accredited_provider",
        "rec",
        "eec_installer",
        "property_manager",
        "other",
      ],
      commercial_model: [
        "hivic_invoices_owner",
        "installer_invoices_owner",
        "not_configured",
      ],
      eligibility_outcome: [
        "likely_eligible",
        "needs_onsite_confirmation",
        "does_not_appear_eligible",
      ],
      evidence_category: [
        "measurement",
        "existing_insulation_r_value",
        "before_ceiling_space",
        "access_manhole",
        "product_evidence",
        "installation_progress",
        "completed_installation",
        "piesa_signoff",
        "rectification_completion",
        "installer_declaration",
      ],
      evidence_status: [
        "outstanding",
        "uploaded",
        "verified",
        "rejected",
        "not_required",
      ],
      job_channel: ["hivic_sourced", "installer_sourced"],
      job_stage: [
        "new_enquiry",
        "eligibility_review",
        "awaiting_electrician",
        "assessment_booking",
        "assessment_booked",
        "assessment_complete",
        "rectification_required",
        "awaiting_owner_rectification_approval",
        "awaiting_deposit_payment",
        "rectification_scheduling",
        "rectification_booked",
        "ready_for_installer_quotes",
        "awaiting_quote_acceptance",
        "installation_scheduling",
        "installation_booked",
        "evidence_outstanding",
        "ap_review",
        "ready_for_veec",
        "complete",
        "cancelled",
        "on_hold",
      ],
      measurement_source: ["electrician", "installer", "admin_import"],
      measurement_status: ["draft", "needs_review", "complete", "rejected"],
      occupancy_type: ["owner_occupied", "rental"],
      pass_fail: ["pending", "pass", "fail"],
      payment_status: [
        "invoice_not_created",
        "invoice_created",
        "deposit_due",
        "deposit_paid",
        "balance_due",
        "fully_paid",
        "overdue",
        "xero_sync_error",
      ],
      quote_kind: ["installation", "rectification"],
      quote_status: ["draft", "issued", "accepted", "declined", "superseded"],
      rate_card_kind: ["installer", "electrical"],
      sync_status: ["not_synced", "pending", "synced", "error"],
    },
  },
} as const

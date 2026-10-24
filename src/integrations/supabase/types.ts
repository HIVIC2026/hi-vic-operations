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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      admin_config_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          summary: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          summary: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          summary?: string
        }
        Relationships: []
      }
      application_reviews: {
        Row: {
          application_id: string
          created_at: string
          created_by: string
          decision: string
          email_detail: string | null
          email_status: string
          id: string
          message: string | null
          reopened_application_id: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          created_by: string
          decision: string
          email_detail?: string | null
          email_status?: string
          id?: string
          message?: string | null
          reopened_application_id?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          created_by?: string
          decision?: string
          email_detail?: string | null
          email_status?: string
          id?: string
          message?: string | null
          reopened_application_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_reviews_reopened_application_id_fkey"
            columns: ["reopened_application_id"]
            isOneToOne: true
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_proposals: {
        Row: {
          assignment_id: string | null
          created_at: string
          electrician_window: boolean
          ends_at: string | null
          id: string
          install_day: boolean
          job_id: string
          kind: Database["public"]["Enums"]["booking_kind"]
          note: string | null
          piesa_window_round: number | null
          proposed_by: string
          proposer_role: string
          responded_at: string | null
          responded_by: string | null
          response_note: string | null
          starts_at: string
          status: string
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          electrician_window?: boolean
          ends_at?: string | null
          id?: string
          install_day?: boolean
          job_id: string
          kind?: Database["public"]["Enums"]["booking_kind"]
          note?: string | null
          piesa_window_round?: number | null
          proposed_by: string
          proposer_role: string
          responded_at?: string | null
          responded_by?: string | null
          response_note?: string | null
          starts_at: string
          status?: string
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          electrician_window?: boolean
          ends_at?: string | null
          id?: string
          install_day?: boolean
          job_id?: string
          kind?: Database["public"]["Enums"]["booking_kind"]
          note?: string | null
          piesa_window_round?: number | null
          proposed_by?: string
          proposer_role?: string
          responded_at?: string | null
          responded_by?: string | null
          response_note?: string | null
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_proposals_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "appointment_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_proposals_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_acceptances: {
        Row: {
          accepted_at: string
          accepted_ip: unknown
          accepted_user_agent: string | null
          assessment_amount_inc_gst: number
          copy_version: string
          customer_total_inc_gst: number
          estimate_id: string
          estimate_input_signature: string
          estimate_settings_version: number
          estimated_discount_inc_gst: number
          estimated_remaining_balance_inc_gst: number
          id: string
          job_id: string
          snapshot: Json
        }
        Insert: {
          accepted_at?: string
          accepted_ip?: unknown
          accepted_user_agent?: string | null
          assessment_amount_inc_gst: number
          copy_version: string
          customer_total_inc_gst: number
          estimate_id: string
          estimate_input_signature: string
          estimate_settings_version: number
          estimated_discount_inc_gst: number
          estimated_remaining_balance_inc_gst: number
          id?: string
          job_id: string
          snapshot: Json
        }
        Update: {
          accepted_at?: string
          accepted_ip?: unknown
          accepted_user_agent?: string | null
          assessment_amount_inc_gst?: number
          copy_version?: string
          customer_total_inc_gst?: number
          estimate_id?: string
          estimate_input_signature?: string
          estimate_settings_version?: number
          estimated_discount_inc_gst?: number
          estimated_remaining_balance_inc_gst?: number
          id?: string
          job_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "assessment_acceptances_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "indicative_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "assessment_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_payment_attempts: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          job_id: string
          outcome: string
          payment_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          job_id: string
          outcome: string
          payment_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          job_id?: string
          outcome?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "assessment_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payment_attempts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "assessment_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_payments: {
        Row: {
          acceptance_id: string
          amount_inc_gst: number
          attempt_count: number
          created_at: string
          failed_at: string | null
          id: string
          job_id: string
          mode: string
          paid_at: string | null
          purpose: string
          status: string
          updated_at: string
        }
        Insert: {
          acceptance_id: string
          amount_inc_gst: number
          attempt_count?: number
          created_at?: string
          failed_at?: string | null
          id?: string
          job_id: string
          mode?: string
          paid_at?: string | null
          purpose?: string
          status?: string
          updated_at?: string
        }
        Update: {
          acceptance_id?: string
          amount_inc_gst?: number
          attempt_count?: number
          created_at?: string
          failed_at?: string | null
          id?: string
          job_id?: string
          mode?: string
          paid_at?: string | null
          purpose?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_payments_acceptance_id_fkey"
            columns: ["acceptance_id"]
            isOneToOne: true
            referencedRelation: "assessment_acceptances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "assessment_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
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
          no_rectification_confirmed: boolean | null
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
          no_rectification_confirmed?: boolean | null
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
          no_rectification_confirmed?: boolean | null
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
          {
            foreignKeyName: "assessments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_job_list"
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
            foreignKeyName: "assignment_variations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_variations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          assignment_id: string | null
          booked_by: string | null
          business_id: string | null
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
          assignment_id?: string | null
          booked_by?: string | null
          business_id?: string | null
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
          assignment_id?: string | null
          booked_by?: string | null
          business_id?: string | null
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
            foreignKeyName: "bookings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_booked_by_fkey"
            columns: ["booked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          {
            foreignKeyName: "bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_attachment_repairs: {
        Row: {
          actor_id: string
          business_id: string
          created_at: string
          document_id: string
          id: string
          job_id: string
          original_path: string
          row_id: string
          storage_path: string
        }
        Insert: {
          actor_id: string
          business_id: string
          created_at?: string
          document_id: string
          id?: string
          job_id: string
          original_path: string
          row_id: string
          storage_path: string
        }
        Update: {
          actor_id?: string
          business_id?: string
          created_at?: string
          document_id?: string
          id?: string
          job_id?: string
          original_path?: string
          row_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_attachment_repairs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_attachment_repairs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_attachment_repairs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_attachment_repairs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "bulk_import_attachment_repairs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_attachment_repairs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_attachment_repairs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_attachment_repairs_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_batches: {
        Row: {
          business_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string
          electrician_plan: Json
          file_manifest: Json
          id: string
          list_filename: string | null
          on_behalf: boolean
          status: string
          summary: Json | null
        }
        Insert: {
          business_id: string
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          electrician_plan?: Json
          file_manifest?: Json
          id?: string
          list_filename?: string | null
          on_behalf?: boolean
          status?: string
          summary?: Json | null
        }
        Update: {
          business_id?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          electrician_plan?: Json
          file_manifest?: Json
          id?: string
          list_filename?: string | null
          on_behalf?: boolean
          status?: string
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_batches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_rows: {
        Row: {
          batch_id: string
          confirm_claim_token: string | null
          confirm_error: string | null
          confirm_lease_until: string | null
          confirm_snapshot: Json | null
          created_at: string
          duplicate_note: string | null
          electrician_plan: Json | null
          extracted: Json
          id: string
          import_stage: string
          job_id: string | null
          match_confidence: string | null
          matched_files: Json
          missing_evidence: Json
          office_review_reason: string | null
          row_index: number
          sort_reasons: Json
          sort_result: string | null
          status: string
        }
        Insert: {
          batch_id: string
          confirm_claim_token?: string | null
          confirm_error?: string | null
          confirm_lease_until?: string | null
          confirm_snapshot?: Json | null
          created_at?: string
          duplicate_note?: string | null
          electrician_plan?: Json | null
          extracted?: Json
          id?: string
          import_stage?: string
          job_id?: string | null
          match_confidence?: string | null
          matched_files?: Json
          missing_evidence?: Json
          office_review_reason?: string | null
          row_index: number
          sort_reasons?: Json
          sort_result?: string | null
          status?: string
        }
        Update: {
          batch_id?: string
          confirm_claim_token?: string | null
          confirm_error?: string | null
          confirm_lease_until?: string | null
          confirm_snapshot?: Json | null
          created_at?: string
          duplicate_note?: string | null
          electrician_plan?: Json | null
          extracted?: Json
          id?: string
          import_stage?: string
          job_id?: string | null
          match_confidence?: string | null
          matched_files?: Json
          missing_evidence?: Json
          office_review_reason?: string | null
          row_index?: number
          sort_reasons?: Json
          sort_result?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "bulk_import_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_rows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      business_bank_detail_events: {
        Row: {
          actor_id: string
          business_id: string
          created_at: string
          details: Json
          event_type: string
          id: string
        }
        Insert: {
          actor_id: string
          business_id: string
          created_at?: string
          details?: Json
          event_type: string
          id?: string
        }
        Update: {
          actor_id?: string
          business_id?: string
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_bank_detail_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_bank_detail_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_bank_details: {
        Row: {
          account_name: string
          account_number: string
          bsb: string
          business_id: string
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          supplied_at: string | null
          supplied_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_name: string
          account_number: string
          bsb: string
          business_id: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          supplied_at?: string | null
          supplied_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_name?: string
          account_number?: string
          bsb?: string
          business_id?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          supplied_at?: string | null
          supplied_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_bank_details_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_bank_details_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_bank_details_supplied_by_fkey"
            columns: ["supplied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_bank_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      business_credentials: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          critical: boolean
          document_path: string | null
          expires_at: string | null
          id: string
          issuer: string | null
          kind: string
          label: string
          number: string | null
          profile_id: string | null
          verification: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          critical?: boolean
          document_path?: string | null
          expires_at?: string | null
          id?: string
          issuer?: string | null
          kind: string
          label: string
          number?: string | null
          profile_id?: string | null
          verification?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          critical?: boolean
          document_path?: string | null
          expires_at?: string | null
          id?: string
          issuer?: string | null
          kind?: string
          label?: string
          number?: string | null
          profile_id?: string | null
          verification?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_credentials_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_credentials_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_credentials_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          active: boolean
          added_by: string | null
          business_id: string
          created_at: string
          id: string
          member_role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          added_by?: string | null
          business_id: string
          created_at?: string
          id?: string
          member_role?: string
          user_id: string
        }
        Update: {
          active?: boolean
          added_by?: string | null
          business_id?: string
          created_at?: string
          id?: string
          member_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          abn: string | null
          accepting_new_jobs: boolean | null
          acn: string | null
          address: string | null
          approval_message_queued_at: string | null
          approval_message_status: string | null
          approved_at: string | null
          approved_by: string | null
          availability_notes: string | null
          base_suburb: string | null
          branding: Json
          business_type: Database["public"]["Enums"]["business_type"]
          capabilities: string[]
          commercial_route: string
          contact_people: Json
          coverage_lat: number | null
          coverage_lng: number | null
          coverage_radius_km: number | null
          coverage_verified_at: string | null
          coverage_verified_by: string | null
          covers_all_victoria: boolean | null
          created_at: string
          daily_capacity_m2: number | null
          daily_job_limit: number | null
          declared_excluded_areas: string | null
          declared_service_origin: string | null
          declared_travel_radius_km: number | null
          default_comms_owner: string
          email: string | null
          free_measureups_for_hivic_quote_leads: boolean | null
          free_quotes_for_hivic_leads: boolean | null
          gst_registered: boolean | null
          id: string
          installer_certification: Json
          is_active: boolean
          lead_time: string | null
          lead_time_days: number | null
          legal_name: string | null
          licence_number: string | null
          mitti_account_invited: boolean
          mitti_account_invited_at: string | null
          mitti_account_invited_by: string | null
          name: string
          onboarding_notes: string | null
          onboarding_status: string
          phone: string | null
          public_liability_cover_amount: number | null
          rec_number: string | null
          receives_hivic_leads: boolean | null
          service_postcodes: string[]
          service_regions: string[]
          signer_email: string | null
          signer_mobile: string | null
          signer_name: string | null
          signer_position: string | null
          trading_name: string | null
          typical_days: string[] | null
          updated_at: string
          weekly_capacity: number | null
          xero_contact_error: string | null
          xero_contact_id: string | null
          xero_contact_status: string
          xero_contact_synced_at: string | null
        }
        Insert: {
          abn?: string | null
          accepting_new_jobs?: boolean | null
          acn?: string | null
          address?: string | null
          approval_message_queued_at?: string | null
          approval_message_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          availability_notes?: string | null
          base_suburb?: string | null
          branding?: Json
          business_type: Database["public"]["Enums"]["business_type"]
          capabilities?: string[]
          commercial_route?: string
          contact_people?: Json
          coverage_lat?: number | null
          coverage_lng?: number | null
          coverage_radius_km?: number | null
          coverage_verified_at?: string | null
          coverage_verified_by?: string | null
          covers_all_victoria?: boolean | null
          created_at?: string
          daily_capacity_m2?: number | null
          daily_job_limit?: number | null
          declared_excluded_areas?: string | null
          declared_service_origin?: string | null
          declared_travel_radius_km?: number | null
          default_comms_owner?: string
          email?: string | null
          free_measureups_for_hivic_quote_leads?: boolean | null
          free_quotes_for_hivic_leads?: boolean | null
          gst_registered?: boolean | null
          id?: string
          installer_certification?: Json
          is_active?: boolean
          lead_time?: string | null
          lead_time_days?: number | null
          legal_name?: string | null
          licence_number?: string | null
          mitti_account_invited?: boolean
          mitti_account_invited_at?: string | null
          mitti_account_invited_by?: string | null
          name: string
          onboarding_notes?: string | null
          onboarding_status?: string
          phone?: string | null
          public_liability_cover_amount?: number | null
          rec_number?: string | null
          receives_hivic_leads?: boolean | null
          service_postcodes?: string[]
          service_regions?: string[]
          signer_email?: string | null
          signer_mobile?: string | null
          signer_name?: string | null
          signer_position?: string | null
          trading_name?: string | null
          typical_days?: string[] | null
          updated_at?: string
          weekly_capacity?: number | null
          xero_contact_error?: string | null
          xero_contact_id?: string | null
          xero_contact_status?: string
          xero_contact_synced_at?: string | null
        }
        Update: {
          abn?: string | null
          accepting_new_jobs?: boolean | null
          acn?: string | null
          address?: string | null
          approval_message_queued_at?: string | null
          approval_message_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          availability_notes?: string | null
          base_suburb?: string | null
          branding?: Json
          business_type?: Database["public"]["Enums"]["business_type"]
          capabilities?: string[]
          commercial_route?: string
          contact_people?: Json
          coverage_lat?: number | null
          coverage_lng?: number | null
          coverage_radius_km?: number | null
          coverage_verified_at?: string | null
          coverage_verified_by?: string | null
          covers_all_victoria?: boolean | null
          created_at?: string
          daily_capacity_m2?: number | null
          daily_job_limit?: number | null
          declared_excluded_areas?: string | null
          declared_service_origin?: string | null
          declared_travel_radius_km?: number | null
          default_comms_owner?: string
          email?: string | null
          free_measureups_for_hivic_quote_leads?: boolean | null
          free_quotes_for_hivic_leads?: boolean | null
          gst_registered?: boolean | null
          id?: string
          installer_certification?: Json
          is_active?: boolean
          lead_time?: string | null
          lead_time_days?: number | null
          legal_name?: string | null
          licence_number?: string | null
          mitti_account_invited?: boolean
          mitti_account_invited_at?: string | null
          mitti_account_invited_by?: string | null
          name?: string
          onboarding_notes?: string | null
          onboarding_status?: string
          phone?: string | null
          public_liability_cover_amount?: number | null
          rec_number?: string | null
          receives_hivic_leads?: boolean | null
          service_postcodes?: string[]
          service_regions?: string[]
          signer_email?: string | null
          signer_mobile?: string | null
          signer_name?: string | null
          signer_position?: string | null
          trading_name?: string | null
          typical_days?: string[] | null
          updated_at?: string
          weekly_capacity?: number | null
          xero_contact_error?: string | null
          xero_contact_id?: string | null
          xero_contact_status?: string
          xero_contact_synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calculator_interests: {
        Row: {
          address_line: string
          admin_notes: string | null
          ceiling_m2: number
          consent_version: string
          consented_at: string
          created_at: string
          email: string
          followed_up_at: string | null
          followed_up_by: string | null
          full_name: string
          id: string
          insulation_declared: string
          mobile: string
          postcode: string
          source: string
          status: string
          suburb: string
          updated_at: string
        }
        Insert: {
          address_line: string
          admin_notes?: string | null
          ceiling_m2: number
          consent_version: string
          consented_at?: string
          created_at?: string
          email: string
          followed_up_at?: string | null
          followed_up_by?: string | null
          full_name: string
          id?: string
          insulation_declared: string
          mobile: string
          postcode: string
          source?: string
          status?: string
          suburb?: string
          updated_at?: string
        }
        Update: {
          address_line?: string
          admin_notes?: string | null
          ceiling_m2?: number
          consent_version?: string
          consented_at?: string
          created_at?: string
          email?: string
          followed_up_at?: string | null
          followed_up_by?: string | null
          full_name?: string
          id?: string
          insulation_declared?: string
          mobile?: string
          postcode?: string
          source?: string
          status?: string
          suburb?: string
          updated_at?: string
        }
        Relationships: []
      }
      ceiling_measurements: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_reason: string | null
          accepted_standard_version: string | null
          access_difficulty:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          assumptions: string | null
          completed_at: string | null
          completed_by: string | null
          confidence: string | null
          created_at: string
          created_by: string | null
          evidence_notes: string | null
          excluded_area_m2: number | null
          existing_r_value: number | null
          external_id: string | null
          external_source: string | null
          gross_area_m2: number | null
          id: string
          insulation_present: boolean | null
          is_current: boolean
          job_id: string
          measured_area_m2: number | null
          measured_by_business_id: string | null
          measured_by_name: string | null
          measured_by_role: string | null
          measured_on: string | null
          measurement_method: string | null
          measurement_purpose: string | null
          partner_method_id: string | null
          provenance: string
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
          supplied_area_m2: number | null
          supplied_removal_m2: number | null
          supplied_snapshot: Json | null
          updated_at: string
          variance_m2: number | null
          variance_pct: number | null
          verified_area_m2: number | null
          verified_at: string | null
          verified_by: string | null
          verified_method: string | null
          verified_role: string | null
          zones: Json
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_reason?: string | null
          accepted_standard_version?: string | null
          access_difficulty?:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          assumptions?: string | null
          completed_at?: string | null
          completed_by?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          evidence_notes?: string | null
          excluded_area_m2?: number | null
          existing_r_value?: number | null
          external_id?: string | null
          external_source?: string | null
          gross_area_m2?: number | null
          id?: string
          insulation_present?: boolean | null
          is_current?: boolean
          job_id: string
          measured_area_m2?: number | null
          measured_by_business_id?: string | null
          measured_by_name?: string | null
          measured_by_role?: string | null
          measured_on?: string | null
          measurement_method?: string | null
          measurement_purpose?: string | null
          partner_method_id?: string | null
          provenance?: string
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
          supplied_area_m2?: number | null
          supplied_removal_m2?: number | null
          supplied_snapshot?: Json | null
          updated_at?: string
          variance_m2?: number | null
          variance_pct?: number | null
          verified_area_m2?: number | null
          verified_at?: string | null
          verified_by?: string | null
          verified_method?: string | null
          verified_role?: string | null
          zones?: Json
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_reason?: string | null
          accepted_standard_version?: string | null
          access_difficulty?:
            | Database["public"]["Enums"]["access_difficulty"]
            | null
          assumptions?: string | null
          completed_at?: string | null
          completed_by?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          evidence_notes?: string | null
          excluded_area_m2?: number | null
          existing_r_value?: number | null
          external_id?: string | null
          external_source?: string | null
          gross_area_m2?: number | null
          id?: string
          insulation_present?: boolean | null
          is_current?: boolean
          job_id?: string
          measured_area_m2?: number | null
          measured_by_business_id?: string | null
          measured_by_name?: string | null
          measured_by_role?: string | null
          measured_on?: string | null
          measurement_method?: string | null
          measurement_purpose?: string | null
          partner_method_id?: string | null
          provenance?: string
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
          supplied_area_m2?: number | null
          supplied_removal_m2?: number | null
          supplied_snapshot?: Json | null
          updated_at?: string
          variance_m2?: number | null
          variance_pct?: number | null
          verified_area_m2?: number | null
          verified_at?: string | null
          verified_by?: string | null
          verified_method?: string | null
          verified_role?: string | null
          zones?: Json
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
            foreignKeyName: "ceiling_measurements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ceiling_measurements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ceiling_measurements_measured_by_business_id_fkey"
            columns: ["measured_by_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          {
            foreignKeyName: "compliance_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          requires_final_consumer_signature: boolean
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
          requires_final_consumer_signature?: boolean
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
          requires_final_consumer_signature?: boolean
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
      contact_releases: {
        Row: {
          assignment_id: string
          id: string
          job_id: string
          owner_notice: string
          released_at: string
          released_by: string | null
          revoked_at: string | null
          trade_notice: string
          visit_kind: string
        }
        Insert: {
          assignment_id: string
          id?: string
          job_id: string
          owner_notice: string
          released_at?: string
          released_by?: string | null
          revoked_at?: string | null
          trade_notice: string
          visit_kind: string
        }
        Update: {
          assignment_id?: string
          id?: string
          job_id?: string
          owner_notice?: string
          released_at?: string
          released_by?: string | null
          revoked_at?: string | null
          trade_notice?: string
          visit_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_releases_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_releases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_releases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "contact_releases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_releases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_releases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_releases_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      correspondence_reviews: {
        Row: {
          attachment_refs: Json
          body: string
          candidate_job_ids: string[]
          communication_id: string | null
          created_at: string
          direction: string
          from_address: string | null
          id: string
          job_id: string | null
          kind: string
          message_at: string | null
          provider: string
          provider_message_id: string
          provider_thread_id: string | null
          reason: string
          recipients: Json
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string | null
          suggested_reason: string | null
        }
        Insert: {
          attachment_refs?: Json
          body?: string
          candidate_job_ids?: string[]
          communication_id?: string | null
          created_at?: string
          direction: string
          from_address?: string | null
          id?: string
          job_id?: string | null
          kind: string
          message_at?: string | null
          provider?: string
          provider_message_id: string
          provider_thread_id?: string | null
          reason: string
          recipients?: Json
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
          suggested_reason?: string | null
        }
        Update: {
          attachment_refs?: Json
          body?: string
          candidate_job_ids?: string[]
          communication_id?: string | null
          created_at?: string
          direction?: string
          from_address?: string | null
          id?: string
          job_id?: string | null
          kind?: string
          message_at?: string | null
          provider?: string
          provider_message_id?: string
          provider_thread_id?: string | null
          reason?: string
          recipients?: Json
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
          suggested_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "correspondence_reviews_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "job_communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondence_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondence_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "correspondence_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondence_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondence_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_nonces: {
        Row: {
          created_at: string
          nonce: string
          purpose: string
        }
        Insert: {
          created_at?: string
          nonce: string
          purpose: string
        }
        Update: {
          created_at?: string
          nonce?: string
          purpose?: string
        }
        Relationships: []
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
            foreignKeyName: "customer_agreements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_agreements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          conditional_snapshot: Json | null
          consumer_copy_path: string | null
          consumer_declaration_version: string | null
          consumer_final_ip: string | null
          consumer_final_required: boolean
          consumer_final_signature_name: string | null
          consumer_final_signed_at: string | null
          consumer_final_signed_by: string | null
          consumer_final_snapshot_sha256: string | null
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
          signed_stage: string
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
          conditional_snapshot?: Json | null
          consumer_copy_path?: string | null
          consumer_declaration_version?: string | null
          consumer_final_ip?: string | null
          consumer_final_required?: boolean
          consumer_final_signature_name?: string | null
          consumer_final_signed_at?: string | null
          consumer_final_signed_by?: string | null
          consumer_final_snapshot_sha256?: string | null
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
          signed_stage?: string
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
          conditional_snapshot?: Json | null
          consumer_copy_path?: string | null
          consumer_declaration_version?: string | null
          consumer_final_ip?: string | null
          consumer_final_required?: boolean
          consumer_final_signature_name?: string | null
          consumer_final_signed_at?: string | null
          consumer_final_signed_by?: string | null
          consumer_final_snapshot_sha256?: string | null
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
          signed_stage?: string
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
            foreignKeyName: "customer_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      customer_communication_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body_markdown: string
          created_at: string
          created_by: string
          id: string
          regulated_copy_locked: boolean
          source_note: string | null
          status: string
          subject: string
          template_key: string
          version: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body_markdown: string
          created_at?: string
          created_by: string
          id?: string
          regulated_copy_locked?: boolean
          source_note?: string | null
          status?: string
          subject: string
          template_key: string
          version: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body_markdown?: string
          created_at?: string
          created_by?: string
          id?: string
          regulated_copy_locked?: boolean
          source_note?: string | null
          status?: string
          subject?: string
          template_key?: string
          version?: string
        }
        Relationships: []
      }
      customer_delivery_settings: {
        Row: {
          enabled: boolean
          endpoint_url: string | null
          hmac_secret: string | null
          id: number
          jobs_created_after: string | null
          provider: string
          ready_check_available_postcodes: string[]
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          endpoint_url?: string | null
          hmac_secret?: string | null
          id?: number
          jobs_created_after?: string | null
          provider?: string
          ready_check_available_postcodes?: string[]
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          endpoint_url?: string | null
          hmac_secret?: string | null
          id?: number
          jobs_created_after?: string | null
          provider?: string
          ready_check_available_postcodes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      customer_email_optouts: {
        Row: {
          created_at: string
          id: string
          job_id: string
          opted_out_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          opted_out_at?: string | null
          token: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          opted_out_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_email_optouts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_optouts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_email_optouts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_optouts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_optouts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_email_sends: {
        Row: {
          communication_id: string | null
          created_at: string
          error: string | null
          estimate_link_id: string | null
          id: string
          idempotency_key: string
          job_id: string
          provider: string | null
          provider_message_id: string | null
          purpose: string
          sent_at: string | null
          status: string
        }
        Insert: {
          communication_id?: string | null
          created_at?: string
          error?: string | null
          estimate_link_id?: string | null
          id?: string
          idempotency_key: string
          job_id: string
          provider?: string | null
          provider_message_id?: string | null
          purpose: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          communication_id?: string | null
          created_at?: string
          error?: string | null
          estimate_link_id?: string | null
          id?: string
          idempotency_key?: string
          job_id?: string
          provider?: string | null
          provider_message_id?: string | null
          purpose?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_email_sends_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "job_communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_sends_estimate_link_id_fkey"
            columns: ["estimate_link_id"]
            isOneToOne: false
            referencedRelation: "customer_estimate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_email_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_email_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_engagement_events: {
        Row: {
          created_at: string
          dedupe_key: string | null
          estimate_link_id: string | null
          event_type: string
          id: string
          job_id: string
          metadata: Json
          occurred_at: string
          source: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          estimate_link_id?: string | null
          event_type: string
          id?: string
          job_id: string
          metadata?: Json
          occurred_at?: string
          source?: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          estimate_link_id?: string | null
          event_type?: string
          id?: string
          job_id?: string
          metadata?: Json
          occurred_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_engagement_events_estimate_link_id_fkey"
            columns: ["estimate_link_id"]
            isOneToOne: false
            referencedRelation: "customer_estimate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_engagement_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_engagement_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_engagement_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_engagement_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_engagement_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_estimate_links: {
        Row: {
          created_at: string
          current_estimate_id: string | null
          expires_at: string
          id: string
          job_id: string
          last_viewed_at: string | null
          owner_id: string
          purpose: string
          revocation_reason: string | null
          revoked_at: string | null
          status: string
          token: string
          view_count: number
        }
        Insert: {
          created_at?: string
          current_estimate_id?: string | null
          expires_at: string
          id?: string
          job_id: string
          last_viewed_at?: string | null
          owner_id: string
          purpose?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          status?: string
          token: string
          view_count?: number
        }
        Update: {
          created_at?: string
          current_estimate_id?: string | null
          expires_at?: string
          id?: string
          job_id?: string
          last_viewed_at?: string | null
          owner_id?: string
          purpose?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          status?: string
          token?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_estimate_links_current_estimate_id_fkey"
            columns: ["current_estimate_id"]
            isOneToOne: false
            referencedRelation: "indicative_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_estimate_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_estimate_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_estimate_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_estimate_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_estimate_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_estimate_links_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "customer_estimate_links_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "customer_estimate_links_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_followups: {
        Row: {
          attempts: number
          blocked_reason: string | null
          communication_id: string | null
          created_at: string
          due_at: string
          estimate_link_id: string | null
          id: string
          job_id: string
          kind: string
          last_error: string | null
          lease_until: string | null
          reason: string | null
          sent_at: string | null
          slot: string
          status: string
          suppression_reason: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          blocked_reason?: string | null
          communication_id?: string | null
          created_at?: string
          due_at: string
          estimate_link_id?: string | null
          id?: string
          job_id: string
          kind: string
          last_error?: string | null
          lease_until?: string | null
          reason?: string | null
          sent_at?: string | null
          slot: string
          status?: string
          suppression_reason?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          blocked_reason?: string | null
          communication_id?: string | null
          created_at?: string
          due_at?: string
          estimate_link_id?: string | null
          id?: string
          job_id?: string
          kind?: string
          last_error?: string | null
          lease_until?: string | null
          reason?: string | null
          sent_at?: string | null
          slot?: string
          status?: string
          suppression_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_followups_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "job_communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_followups_estimate_link_id_fkey"
            columns: ["estimate_link_id"]
            isOneToOne: false
            referencedRelation: "customer_estimate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_followups_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_followups_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_followups_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_followups_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_followups_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_referral_events: {
        Row: {
          dedupe_key: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          referral_token_id: string
          referred_external_enquiry_id: string | null
        }
        Insert: {
          dedupe_key?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          referral_token_id: string
          referred_external_enquiry_id?: string | null
        }
        Update: {
          dedupe_key?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          referral_token_id?: string
          referred_external_enquiry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_referral_events_referral_token_id_fkey"
            columns: ["referral_token_id"]
            isOneToOne: false
            referencedRelation: "customer_referral_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_referral_tokens: {
        Row: {
          click_count: number
          created_at: string
          external_enquiry_id: string | null
          id: string
          job_id: string | null
          last_used_at: string | null
          referred_submission_count: number
          status: string
          token: string
        }
        Insert: {
          click_count?: number
          created_at?: string
          external_enquiry_id?: string | null
          id?: string
          job_id?: string | null
          last_used_at?: string | null
          referred_submission_count?: number
          status?: string
          token: string
        }
        Update: {
          click_count?: number
          created_at?: string
          external_enquiry_id?: string | null
          id?: string
          job_id?: string | null
          last_used_at?: string | null
          referred_submission_count?: number
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_referral_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_referral_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "customer_referral_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_referral_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_referral_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_briefs: {
        Row: {
          brief_date: string
          content: Json
          created_at: string
          delivery_status: string
          id: string
        }
        Insert: {
          brief_date: string
          content: Json
          created_at?: string
          delivery_status?: string
          id?: string
        }
        Update: {
          brief_date?: string
          content?: Json
          created_at?: string
          delivery_status?: string
          id?: string
        }
        Relationships: []
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
          {
            foreignKeyName: "declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          job_id: string | null
          kind: string
          mime_type: string | null
          original_name: string | null
          size_bytes: number | null
          source_system: string | null
          storage_path: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          job_id?: string | null
          kind: string
          mime_type?: string | null
          original_name?: string | null
          size_bytes?: number | null
          source_system?: string | null
          storage_path: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          job_id?: string | null
          kind?: string
          mime_type?: string | null
          original_name?: string | null
          size_bytes?: number | null
          source_system?: string | null
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
            foreignKeyName: "documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      electrical_allowance_snapshots: {
        Row: {
          allowance_total_inc_gst: number
          created_at: string
          id: string
          job_id: string
          lines: Json
          preliminary_only: boolean
          rate_card_id: string | null
          rate_card_version: number
          ready_check_id: string
          ready_check_version: number
          unpriceable: Json
        }
        Insert: {
          allowance_total_inc_gst: number
          created_at?: string
          id?: string
          job_id: string
          lines: Json
          preliminary_only?: boolean
          rate_card_id?: string | null
          rate_card_version: number
          ready_check_id: string
          ready_check_version: number
          unpriceable?: Json
        }
        Update: {
          allowance_total_inc_gst?: number
          created_at?: string
          id?: string
          job_id?: string
          lines?: Json
          preliminary_only?: boolean
          rate_card_id?: string | null
          rate_card_version?: number
          ready_check_id?: string
          ready_check_version?: number
          unpriceable?: Json
        }
        Relationships: [
          {
            foreignKeyName: "electrical_allowance_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_allowance_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "electrical_allowance_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_allowance_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_allowance_snapshots_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_allowance_snapshots_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rec_rate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrical_allowance_snapshots_ready_check_id_fkey"
            columns: ["ready_check_id"]
            isOneToOne: false
            referencedRelation: "ready_checks"
            referencedColumns: ["id"]
          },
        ]
      }
      electrician_nominations: {
        Row: {
          accepted_at: string | null
          business_id: string | null
          business_name: string | null
          consent_confirmed_at: string | null
          contact_name: string
          created_at: string
          declined_at: string | null
          electrician_application_id: string | null
          email: string | null
          ended_at: string | null
          id: string
          installer_application_id: string | null
          invite_expires_at: string | null
          invite_link_issued_at: string | null
          invite_sent_at: string | null
          invite_token_hash: string | null
          is_primary: boolean
          job_id: string | null
          licence_number: string | null
          nominated_by: string | null
          nominated_for: string
          nominating_business_id: string | null
          opened_at: string | null
          phone: string | null
          rec_number: string | null
          status: string
          teamed_at: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          business_id?: string | null
          business_name?: string | null
          consent_confirmed_at?: string | null
          contact_name: string
          created_at?: string
          declined_at?: string | null
          electrician_application_id?: string | null
          email?: string | null
          ended_at?: string | null
          id?: string
          installer_application_id?: string | null
          invite_expires_at?: string | null
          invite_link_issued_at?: string | null
          invite_sent_at?: string | null
          invite_token_hash?: string | null
          is_primary?: boolean
          job_id?: string | null
          licence_number?: string | null
          nominated_by?: string | null
          nominated_for?: string
          nominating_business_id?: string | null
          opened_at?: string | null
          phone?: string | null
          rec_number?: string | null
          status?: string
          teamed_at?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          business_id?: string | null
          business_name?: string | null
          consent_confirmed_at?: string | null
          contact_name?: string
          created_at?: string
          declined_at?: string | null
          electrician_application_id?: string | null
          email?: string | null
          ended_at?: string | null
          id?: string
          installer_application_id?: string | null
          invite_expires_at?: string | null
          invite_link_issued_at?: string | null
          invite_sent_at?: string | null
          invite_token_hash?: string | null
          is_primary?: boolean
          job_id?: string | null
          licence_number?: string | null
          nominated_by?: string | null
          nominated_for?: string
          nominating_business_id?: string | null
          opened_at?: string | null
          phone?: string | null
          rec_number?: string | null
          status?: string
          teamed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrician_nominations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_electrician_application_id_fkey"
            columns: ["electrician_application_id"]
            isOneToOne: false
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_installer_application_id_fkey"
            columns: ["installer_application_id"]
            isOneToOne: false
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "electrician_nominations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_nominated_by_fkey"
            columns: ["nominated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electrician_nominations_nominating_business_id_fkey"
            columns: ["nominating_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      electrician_rate_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          rate_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          rate_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          rate_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrician_rate_events_rate_id_fkey"
            columns: ["rate_id"]
            isOneToOne: false
            referencedRelation: "electrician_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      electrician_rates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          gst_included: boolean
          id: string
          rate_inc_gst: number
          service_type: string
          source_note: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          gst_included?: boolean
          id?: string
          rate_inc_gst: number
          service_type: string
          source_note: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          gst_included?: boolean
          id?: string
          rate_inc_gst?: number
          service_type?: string
          source_note?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "electrician_rates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      eligibility_verifications: {
        Row: {
          evidence_complete: boolean
          evidence_snapshot: Json
          flags: Json
          id: string
          is_current: boolean
          job_id: string
          note: string | null
          outcome: string
          ready_check_ref: string
          ready_check_version: number
          reason: string | null
          recorded_at: string
          recorded_by: string
          review_reasons: Json
          ruleset: string
          superseded_at: string | null
          supersedes: string | null
        }
        Insert: {
          evidence_complete: boolean
          evidence_snapshot?: Json
          flags?: Json
          id?: string
          is_current?: boolean
          job_id: string
          note?: string | null
          outcome: string
          ready_check_ref: string
          ready_check_version: number
          reason?: string | null
          recorded_at?: string
          recorded_by: string
          review_reasons?: Json
          ruleset: string
          superseded_at?: string | null
          supersedes?: string | null
        }
        Update: {
          evidence_complete?: boolean
          evidence_snapshot?: Json
          flags?: Json
          id?: string
          is_current?: boolean
          job_id?: string
          note?: string | null
          outcome?: string
          ready_check_ref?: string
          ready_check_version?: number
          reason?: string | null
          recorded_at?: string
          recorded_by?: string
          review_reasons?: Json
          ruleset?: string
          superseded_at?: string | null
          supersedes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eligibility_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "eligibility_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_verifications_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "eligibility_verifications"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_tracking_tokens: {
        Row: {
          created_at: string
          email_send_id: string | null
          estimate_link_id: string | null
          expires_at: string
          id: string
          job_id: string
          kind: string
          purpose: string
          token: string
        }
        Insert: {
          created_at?: string
          email_send_id?: string | null
          estimate_link_id?: string | null
          expires_at: string
          id?: string
          job_id: string
          kind: string
          purpose: string
          token: string
        }
        Update: {
          created_at?: string
          email_send_id?: string | null
          estimate_link_id?: string | null
          expires_at?: string
          id?: string
          job_id?: string
          kind?: string
          purpose?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_tracking_tokens_email_send_id_fkey"
            columns: ["email_send_id"]
            isOneToOne: false
            referencedRelation: "customer_email_sends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_tracking_tokens_estimate_link_id_fkey"
            columns: ["estimate_link_id"]
            isOneToOne: false
            referencedRelation: "customer_estimate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_tracking_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_tracking_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "engagement_tracking_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_tracking_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_tracking_tokens_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            foreignKeyName: "esc_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          captured_at: string | null
          distance_m: number | null
          file_name: string
          id: string
          job_id: string
          lat: number | null
          lng: number | null
          location_accuracy_m: number | null
          location_source: string | null
          mime_type: string | null
          requirement_id: string
          size_bytes: number | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          captured_at?: string | null
          distance_m?: number | null
          file_name: string
          id?: string
          job_id: string
          lat?: number | null
          lng?: number | null
          location_accuracy_m?: number | null
          location_source?: string | null
          mime_type?: string | null
          requirement_id: string
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          captured_at?: string | null
          distance_m?: number | null
          file_name?: string
          id?: string
          job_id?: string
          lat?: number | null
          lng?: number | null
          location_accuracy_m?: number | null
          location_source?: string | null
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
            foreignKeyName: "evidence_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          area_key: string | null
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
          area_key?: string | null
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
          area_key?: string | null
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
            foreignKeyName: "evidence_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      external_action_events: {
        Row: {
          action_type: string | null
          actor_id: string | null
          at: string
          details: Json
          event_type: string
          id: string
          outbox_id: string | null
        }
        Insert: {
          action_type?: string | null
          actor_id?: string | null
          at?: string
          details?: Json
          event_type: string
          id?: string
          outbox_id?: string | null
        }
        Update: {
          action_type?: string | null
          actor_id?: string | null
          at?: string
          details?: Json
          event_type?: string
          id?: string
          outbox_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_action_events_action_type_fkey"
            columns: ["action_type"]
            isOneToOne: false
            referencedRelation: "external_action_modes"
            referencedColumns: ["action_type"]
          },
          {
            foreignKeyName: "external_action_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_events_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "external_action_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      external_action_modes: {
        Row: {
          action_type: string
          mode: string
          reason: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action_type: string
          mode?: string
          reason?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action_type?: string
          mode?: string
          reason?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_action_modes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      external_action_outbox: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          attempt_count: number
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          completed_ref: string | null
          created_at: string
          delivery_basis: string
          due_at: string | null
          event_type: string
          facts_hash: string
          id: string
          idempotency_key: string
          job_id: string
          last_attempt_at: string | null
          last_error_code: string | null
          lease_id: string | null
          lease_until: string | null
          payload_ref: string
          source_event_id: string
          status: string
          superseded_by: string | null
          target_ref: string
          template_version: string
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          completed_ref?: string | null
          created_at?: string
          delivery_basis: string
          due_at?: string | null
          event_type: string
          facts_hash: string
          id?: string
          idempotency_key: string
          job_id: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          lease_id?: string | null
          lease_until?: string | null
          payload_ref: string
          source_event_id: string
          status?: string
          superseded_by?: string | null
          target_ref: string
          template_version: string
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          completed_ref?: string | null
          created_at?: string
          delivery_basis?: string
          due_at?: string | null
          event_type?: string
          facts_hash?: string
          id?: string
          idempotency_key?: string
          job_id?: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          lease_id?: string | null
          lease_until?: string | null
          payload_ref?: string
          source_event_id?: string
          status?: string
          superseded_by?: string | null
          target_ref?: string
          template_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_action_outbox_action_type_fkey"
            columns: ["action_type"]
            isOneToOne: false
            referencedRelation: "external_action_modes"
            referencedColumns: ["action_type"]
          },
          {
            foreignKeyName: "external_action_outbox_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_outbox_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_outbox_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "external_action_outbox_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_outbox_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_outbox_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_outbox_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "workflow_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_outbox_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "external_action_outbox"
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
      first_response_retries: {
        Row: {
          attempt_count: number
          claim_token: string | null
          job_id: string
          last_attempt_at: string | null
          last_outcome: string | null
          last_reason: string | null
          last_recorded_at: string | null
          last_route: string | null
          lease_until: string | null
          next_attempt_at: string
        }
        Insert: {
          attempt_count?: number
          claim_token?: string | null
          job_id: string
          last_attempt_at?: string | null
          last_outcome?: string | null
          last_reason?: string | null
          last_recorded_at?: string | null
          last_route?: string | null
          lease_until?: string | null
          next_attempt_at?: string
        }
        Update: {
          attempt_count?: number
          claim_token?: string | null
          job_id?: string
          last_attempt_at?: string | null
          last_outcome?: string | null
          last_reason?: string | null
          last_recorded_at?: string | null
          last_route?: string | null
          lease_until?: string | null
          next_attempt_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "first_response_retries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_response_retries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "first_response_retries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_response_retries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_response_retries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      indicative_estimates: {
        Row: {
          applied_discount: number
          area_basis: string
          area_m2: number
          area_source: string
          area_source_id: string | null
          created_at: string
          display_mode: string
          eligibility_outcome: string | null
          ghg_savings_factor: number
          id: string
          input_signature: string
          insulation_declared: string | null
          job_id: string
          lifetime_years: number
          location: Json
          postcode: string
          raw_estimated_discount: number
          raw_ghg_reduction: number
          regional_factor: number
          scenarios: Json
          settings_id: string
          settings_version: number
          snapshot: Json
          spec_source_url: string
          spec_version: string
          status: string
          superseded_at: string | null
          veec_checked_at: string
          veec_source_url: string
          veec_value: number
        }
        Insert: {
          applied_discount: number
          area_basis: string
          area_m2: number
          area_source: string
          area_source_id?: string | null
          created_at?: string
          display_mode: string
          eligibility_outcome?: string | null
          ghg_savings_factor: number
          id?: string
          input_signature: string
          insulation_declared?: string | null
          job_id: string
          lifetime_years: number
          location: Json
          postcode: string
          raw_estimated_discount: number
          raw_ghg_reduction: number
          regional_factor: number
          scenarios: Json
          settings_id: string
          settings_version: number
          snapshot: Json
          spec_source_url: string
          spec_version: string
          status?: string
          superseded_at?: string | null
          veec_checked_at: string
          veec_source_url: string
          veec_value: number
        }
        Update: {
          applied_discount?: number
          area_basis?: string
          area_m2?: number
          area_source?: string
          area_source_id?: string | null
          created_at?: string
          display_mode?: string
          eligibility_outcome?: string | null
          ghg_savings_factor?: number
          id?: string
          input_signature?: string
          insulation_declared?: string | null
          job_id?: string
          lifetime_years?: number
          location?: Json
          postcode?: string
          raw_estimated_discount?: number
          raw_ghg_reduction?: number
          regional_factor?: number
          scenarios?: Json
          settings_id?: string
          settings_version?: number
          snapshot?: Json
          spec_source_url?: string
          spec_version?: string
          status?: string
          superseded_at?: string | null
          veec_checked_at?: string
          veec_source_url?: string
          veec_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "indicative_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicative_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "indicative_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicative_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicative_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicative_estimates_settings_id_fkey"
            columns: ["settings_id"]
            isOneToOne: false
            referencedRelation: "retail_estimator_settings"
            referencedColumns: ["id"]
          },
        ]
      }
      install_holds: {
        Row: {
          area_m2: number
          created_at: string
          id: string
          installer_business_id: string | null
          job_id: string
          over_capacity: boolean
          reason: string
          release_reason: string | null
          released_at: string | null
          status: string
          target_week_start: string
          updated_at: string
        }
        Insert: {
          area_m2?: number
          created_at?: string
          id?: string
          installer_business_id?: string | null
          job_id: string
          over_capacity?: boolean
          reason: string
          release_reason?: string | null
          released_at?: string | null
          status?: string
          target_week_start: string
          updated_at?: string
        }
        Update: {
          area_m2?: number
          created_at?: string
          id?: string
          installer_business_id?: string | null
          job_id?: string
          over_capacity?: boolean
          reason?: string
          release_reason?: string | null
          released_at?: string | null
          status?: string
          target_week_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "install_holds_installer_business_id_fkey"
            columns: ["installer_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "install_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "install_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "install_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "install_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "install_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "installer_declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installer_declarations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      installer_rate_requests: {
        Row: {
          business_id: string
          gst_registered: boolean
          id: string
          r6_rate: number | null
          r7_rate: number | null
          rate_card_id: string | null
          requested_at: string
          requested_by: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          topup_r5_rate: number | null
          vacuum_only_rate: number | null
        }
        Insert: {
          business_id: string
          gst_registered?: boolean
          id?: string
          r6_rate?: number | null
          r7_rate?: number | null
          rate_card_id?: string | null
          requested_at?: string
          requested_by: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          topup_r5_rate?: number | null
          vacuum_only_rate?: number | null
        }
        Update: {
          business_id?: string
          gst_registered?: boolean
          id?: string
          r6_rate?: number | null
          r7_rate?: number | null
          rate_card_id?: string | null
          requested_at?: string
          requested_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          topup_r5_rate?: number | null
          vacuum_only_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "installer_rate_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installer_rate_requests_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      instalment_plans: {
        Row: {
          collection_arrangement: string | null
          collection_recorded_at: string | null
          created_at: string
          first_instalment_amount: number | null
          first_instalment_verified_at: string | null
          id: string
          instalment_count: number
          invoice_id: string
          job_id: string
          office_approved_at: string | null
          office_approved_by: string | null
          owner_accepted_at: string | null
          owner_accepted_by: string | null
          quote_id: string
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          collection_arrangement?: string | null
          collection_recorded_at?: string | null
          created_at?: string
          first_instalment_amount?: number | null
          first_instalment_verified_at?: string | null
          id?: string
          instalment_count?: number
          invoice_id: string
          job_id: string
          office_approved_at?: string | null
          office_approved_by?: string | null
          owner_accepted_at?: string | null
          owner_accepted_by?: string | null
          quote_id: string
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          collection_arrangement?: string | null
          collection_recorded_at?: string | null
          created_at?: string
          first_instalment_amount?: number | null
          first_instalment_verified_at?: string | null
          id?: string
          instalment_count?: number
          invoice_id?: string
          job_id?: string
          office_approved_at?: string | null
          office_approved_by?: string | null
          owner_accepted_at?: string | null
          owner_accepted_by?: string | null
          quote_id?: string
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instalment_plans_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_payment_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instalment_plans_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instalment_plans_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instalment_plans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instalment_plans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "instalment_plans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instalment_plans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instalment_plans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instalment_plans_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
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
          payment_option: string | null
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
          payment_option?: string | null
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
          payment_option?: string | null
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
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          booking_confirmed_at: string | null
          business_id: string | null
          cannot_attend_at: string | null
          end_reason: string | null
          ended_at: string | null
          first_response_at: string | null
          id: string
          job_id: string
          role: Database["public"]["Enums"]["assignment_role"]
          user_id: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          booking_confirmed_at?: string | null
          business_id?: string | null
          cannot_attend_at?: string | null
          end_reason?: string | null
          ended_at?: string | null
          first_response_at?: string | null
          id?: string
          job_id: string
          role: Database["public"]["Enums"]["assignment_role"]
          user_id: string
        }
        Update: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          booking_confirmed_at?: string | null
          business_id?: string | null
          cannot_attend_at?: string | null
          end_reason?: string | null
          ended_at?: string | null
          first_response_at?: string | null
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
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          {
            foreignKeyName: "job_communications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_communications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      job_compliance_records: {
        Row: {
          created_at: string
          id: string
          job_id: string
          notes: string | null
          occurred_at: string
          record_key: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          notes?: string | null
          occurred_at: string
          record_key: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          notes?: string | null
          occurred_at?: string
          record_key?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_compliance_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_compliance_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_compliance_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_compliance_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_compliance_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      job_imports: {
        Row: {
          business_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_facts: Json | null
          created_at: string
          created_by: string
          external_refs: Json
          extracted: Json
          extractor_version: string
          files: Json
          id: string
          job_id: string | null
          method: string
          raw_text: string | null
          source_system: string
          source_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_facts?: Json | null
          created_at?: string
          created_by: string
          external_refs?: Json
          extracted?: Json
          extractor_version?: string
          files?: Json
          id?: string
          job_id?: string | null
          method: string
          raw_text?: string | null
          source_system?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_facts?: Json | null
          created_at?: string
          created_by?: string
          external_refs?: Json
          extracted?: Json
          extractor_version?: string
          files?: Json
          id?: string
          job_id?: string | null
          method?: string
          raw_text?: string | null
          source_system?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_imports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_imports_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_imports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_imports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_imports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_imports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_imports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      job_install_windows: {
        Row: {
          buffer_max_days: number
          buffer_min_days: number
          job_id: string
          piesa_completed_at: string | null
          planned_install_date: string | null
          planned_piesa_date: string | null
          updated_at: string
        }
        Insert: {
          buffer_max_days?: number
          buffer_min_days?: number
          job_id: string
          piesa_completed_at?: string | null
          planned_install_date?: string | null
          planned_piesa_date?: string | null
          updated_at?: string
        }
        Update: {
          buffer_max_days?: number
          buffer_min_days?: number
          job_id?: string
          piesa_completed_at?: string | null
          planned_install_date?: string | null
          planned_piesa_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_install_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_install_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_install_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_install_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_install_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          ap_fee_override_at: string | null
          ap_fee_override_by: string | null
          ap_fee_override_inc_gst: number | null
          ap_fee_override_reason: string | null
          business_unit: string
          cancelled_reason: string | null
          channel: Database["public"]["Enums"]["job_channel"]
          commercial_model: Database["public"]["Enums"]["commercial_model"]
          commercial_model_set_at: string | null
          commercial_model_set_by: string | null
          created_at: string
          customer_relationship_owner: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          electrician_choice: string | null
          eligibility_decision_rules: Json
          eligibility_decision_source: string | null
          eligibility_flags: Json
          eligibility_outcome:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_reason: string | null
          eligibility_review_required: boolean
          eligibility_set_at: string | null
          eligibility_set_by: string | null
          estimated_area_m2: number | null
          estimated_area_unknown: boolean
          external_enquiry_id: string | null
          external_refs: Json
          hold_reason: string | null
          hold_revisit_at: string | null
          id: string
          install_10day_flagged_at: string | null
          installation_completed_at: string | null
          installer_led: boolean
          installer_price_includes: string | null
          installer_quoted: string | null
          installer_quoted_price_inc_gst: number | null
          installer_site_check: string | null
          installer_site_check_date: string | null
          job_number: string
          last_activity_at: string
          life_support: boolean
          life_support_status: string | null
          measure_up_responsibility: string
          next_action: string | null
          offer_dispatch_override: string | null
          originating_installer_business_id: string | null
          originating_installer_user_id: string | null
          owner_id: string
          prior_stage: Database["public"]["Enums"]["job_stage"] | null
          property_id: string
          qa_archived_at: string | null
          ready_check_booking_offered_at: string | null
          ready_check_booking_offered_by: string | null
          source: string
          source_system: string | null
          stage: Database["public"]["Enums"]["job_stage"]
          updated_at: string
        }
        Insert: {
          ap_fee_override_at?: string | null
          ap_fee_override_by?: string | null
          ap_fee_override_inc_gst?: number | null
          ap_fee_override_reason?: string | null
          business_unit: string
          cancelled_reason?: string | null
          channel?: Database["public"]["Enums"]["job_channel"]
          commercial_model?: Database["public"]["Enums"]["commercial_model"]
          commercial_model_set_at?: string | null
          commercial_model_set_by?: string | null
          created_at?: string
          customer_relationship_owner?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          electrician_choice?: string | null
          eligibility_decision_rules?: Json
          eligibility_decision_source?: string | null
          eligibility_flags?: Json
          eligibility_outcome?:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_reason?: string | null
          eligibility_review_required?: boolean
          eligibility_set_at?: string | null
          eligibility_set_by?: string | null
          estimated_area_m2?: number | null
          estimated_area_unknown?: boolean
          external_enquiry_id?: string | null
          external_refs?: Json
          hold_reason?: string | null
          hold_revisit_at?: string | null
          id?: string
          install_10day_flagged_at?: string | null
          installation_completed_at?: string | null
          installer_led?: boolean
          installer_price_includes?: string | null
          installer_quoted?: string | null
          installer_quoted_price_inc_gst?: number | null
          installer_site_check?: string | null
          installer_site_check_date?: string | null
          job_number?: string
          last_activity_at?: string
          life_support?: boolean
          life_support_status?: string | null
          measure_up_responsibility?: string
          next_action?: string | null
          offer_dispatch_override?: string | null
          originating_installer_business_id?: string | null
          originating_installer_user_id?: string | null
          owner_id: string
          prior_stage?: Database["public"]["Enums"]["job_stage"] | null
          property_id: string
          qa_archived_at?: string | null
          ready_check_booking_offered_at?: string | null
          ready_check_booking_offered_by?: string | null
          source?: string
          source_system?: string | null
          stage?: Database["public"]["Enums"]["job_stage"]
          updated_at?: string
        }
        Update: {
          ap_fee_override_at?: string | null
          ap_fee_override_by?: string | null
          ap_fee_override_inc_gst?: number | null
          ap_fee_override_reason?: string | null
          business_unit?: string
          cancelled_reason?: string | null
          channel?: Database["public"]["Enums"]["job_channel"]
          commercial_model?: Database["public"]["Enums"]["commercial_model"]
          commercial_model_set_at?: string | null
          commercial_model_set_by?: string | null
          created_at?: string
          customer_relationship_owner?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          electrician_choice?: string | null
          eligibility_decision_rules?: Json
          eligibility_decision_source?: string | null
          eligibility_flags?: Json
          eligibility_outcome?:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_reason?: string | null
          eligibility_review_required?: boolean
          eligibility_set_at?: string | null
          eligibility_set_by?: string | null
          estimated_area_m2?: number | null
          estimated_area_unknown?: boolean
          external_enquiry_id?: string | null
          external_refs?: Json
          hold_reason?: string | null
          hold_revisit_at?: string | null
          id?: string
          install_10day_flagged_at?: string | null
          installation_completed_at?: string | null
          installer_led?: boolean
          installer_price_includes?: string | null
          installer_quoted?: string | null
          installer_quoted_price_inc_gst?: number | null
          installer_site_check?: string | null
          installer_site_check_date?: string | null
          job_number?: string
          last_activity_at?: string
          life_support?: boolean
          life_support_status?: string | null
          measure_up_responsibility?: string
          next_action?: string | null
          offer_dispatch_override?: string | null
          originating_installer_business_id?: string | null
          originating_installer_user_id?: string | null
          owner_id?: string
          prior_stage?: Database["public"]["Enums"]["job_stage"] | null
          property_id?: string
          qa_archived_at?: string | null
          ready_check_booking_offered_at?: string | null
          ready_check_booking_offered_by?: string | null
          source?: string
          source_system?: string | null
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
            referencedRelation: "office_job_list"
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
            referencedRelation: "office_job_list"
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
      journey_runs: {
        Row: {
          created_at: string
          failing_reason: string | null
          failing_step: string | null
          finished_at: string | null
          id: string
          mode: string
          passed: boolean | null
          started_at: string
          steps: Json
          test_job_id: string | null
        }
        Insert: {
          created_at?: string
          failing_reason?: string | null
          failing_step?: string | null
          finished_at?: string | null
          id?: string
          mode: string
          passed?: boolean | null
          started_at?: string
          steps?: Json
          test_job_id?: string | null
        }
        Update: {
          created_at?: string
          failing_reason?: string | null
          failing_step?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          passed?: boolean | null
          started_at?: string
          steps?: Json
          test_job_id?: string | null
        }
        Relationships: []
      }
      lead_campaign_responses: {
        Row: {
          campaign: string
          created_at: string
          desk_check_reason: string | null
          desk_check_status: string
          desk_checked_at: string | null
          desk_checked_by: string | null
          estimate_link_id: string
          id: string
          job_id: string
          media_received_at: string | null
          opted_out_at: string | null
          queue_priority: string
          queue_rank: number | null
          saved_area_m2: number | null
          saved_estimate_id: string | null
          saved_estimate_url: string | null
          saved_gross_total: number | null
          saved_insulation: string | null
          saved_total: number | null
          saved_veu_discount: number | null
          spot_saved_at: string | null
          updated_at: string
          video_requested: boolean
        }
        Insert: {
          campaign?: string
          created_at?: string
          desk_check_reason?: string | null
          desk_check_status?: string
          desk_checked_at?: string | null
          desk_checked_by?: string | null
          estimate_link_id: string
          id?: string
          job_id: string
          media_received_at?: string | null
          opted_out_at?: string | null
          queue_priority?: string
          queue_rank?: number | null
          saved_area_m2?: number | null
          saved_estimate_id?: string | null
          saved_estimate_url?: string | null
          saved_gross_total?: number | null
          saved_insulation?: string | null
          saved_total?: number | null
          saved_veu_discount?: number | null
          spot_saved_at?: string | null
          updated_at?: string
          video_requested?: boolean
        }
        Update: {
          campaign?: string
          created_at?: string
          desk_check_reason?: string | null
          desk_check_status?: string
          desk_checked_at?: string | null
          desk_checked_by?: string | null
          estimate_link_id?: string
          id?: string
          job_id?: string
          media_received_at?: string | null
          opted_out_at?: string | null
          queue_priority?: string
          queue_rank?: number | null
          saved_area_m2?: number | null
          saved_estimate_id?: string | null
          saved_estimate_url?: string | null
          saved_gross_total?: number | null
          saved_insulation?: string | null
          saved_total?: number | null
          saved_veu_discount?: number | null
          spot_saved_at?: string | null
          updated_at?: string
          video_requested?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lead_campaign_responses_estimate_link_id_fkey"
            columns: ["estimate_link_id"]
            isOneToOne: false
            referencedRelation: "customer_estimate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_campaign_responses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_campaign_responses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "lead_campaign_responses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_campaign_responses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_campaign_responses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_job_list"
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
          sender_label: string | null
          worker_id: string | null
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          id?: string
          internal?: boolean
          job_id: string
          sender_id?: string | null
          sender_label?: string | null
          worker_id?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          internal?: boolean
          job_id?: string
          sender_id?: string | null
          sender_label?: string | null
          worker_id?: string | null
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
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "partner_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      mitti_template_dumps: {
        Row: {
          definition: Json | null
          error: string | null
          fetched_at: string | null
          id: number
          name: string | null
          template_id: string | null
        }
        Insert: {
          definition?: Json | null
          error?: string | null
          fetched_at?: string | null
          id?: number
          name?: string | null
          template_id?: string | null
        }
        Update: {
          definition?: Json | null
          error?: string | null
          fetched_at?: string | null
          id?: number
          name?: string | null
          template_id?: string | null
        }
        Relationships: []
      }
      office_snoozes: {
        Row: {
          created_at: string
          id: string
          job_id: string
          reason: string | null
          rule_key: string
          snooze_count: number
          snoozed_by: string
          snoozed_until: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          reason?: string | null
          rule_key: string
          snooze_count?: number
          snoozed_by: string
          snoozed_until: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          reason?: string | null
          rule_key?: string
          snooze_count?: number
          snoozed_by?: string
          snoozed_until?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_snoozes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_snoozes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "office_snoozes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_snoozes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_snoozes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      official_form_deliveries: {
        Row: {
          channel: string
          created_at: string
          delivered_at: string
          id: string
          job_id: string
          recipient_role: string
          recipient_user_id: string | null
          recorded_by: string | null
          signed_copy_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          delivered_at?: string
          id?: string
          job_id: string
          recipient_role: string
          recipient_user_id?: string | null
          recorded_by?: string | null
          signed_copy_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          delivered_at?: string
          id?: string
          job_id?: string
          recipient_role?: string
          recipient_user_id?: string | null
          recorded_by?: string | null
          signed_copy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "official_form_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_form_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "official_form_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_form_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_form_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_form_deliveries_signed_copy_id_fkey"
            columns: ["signed_copy_id"]
            isOneToOne: false
            referencedRelation: "official_form_signed_copies"
            referencedColumns: ["id"]
          },
        ]
      }
      official_form_signed_copies: {
        Row: {
          answers: Json
          attachments: Json
          created_at: string
          document_sha256: string
          form_key: string
          id: string
          invalidated_at: string | null
          invalidated_by: string | null
          invalidation_reason: string | null
          job_facts: Json
          job_id: string
          mapping_version: string
          signature_date: string
          signer_name: string
          signer_role: string
          signer_user_id: string
          snapshot: Json
          snapshot_sha256: string
          source_sha256: string
          status: string
          storage_path: string
          template_publication: string
          template_title: string
        }
        Insert: {
          answers: Json
          attachments?: Json
          created_at?: string
          document_sha256: string
          form_key: string
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidation_reason?: string | null
          job_facts?: Json
          job_id: string
          mapping_version: string
          signature_date: string
          signer_name: string
          signer_role: string
          signer_user_id: string
          snapshot: Json
          snapshot_sha256: string
          source_sha256: string
          status?: string
          storage_path: string
          template_publication: string
          template_title: string
        }
        Update: {
          answers?: Json
          attachments?: Json
          created_at?: string
          document_sha256?: string
          form_key?: string
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          invalidation_reason?: string | null
          job_facts?: Json
          job_id?: string
          mapping_version?: string
          signature_date?: string
          signer_name?: string
          signer_role?: string
          signer_user_id?: string
          snapshot?: Json
          snapshot_sha256?: string
          source_sha256?: string
          status?: string
          storage_path?: string
          template_publication?: string
          template_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "official_form_signed_copies_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_form_signed_copies_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "official_form_signed_copies_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_form_signed_copies_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_form_signed_copies_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_authorisation_events: {
        Row: {
          actor: string | null
          application_id: string | null
          authorisation_id: string | null
          created_at: string
          event: string
          id: number
        }
        Insert: {
          actor?: string | null
          application_id?: string | null
          authorisation_id?: string | null
          created_at?: string
          event: string
          id?: never
        }
        Update: {
          actor?: string | null
          application_id?: string | null
          authorisation_id?: string | null
          created_at?: string
          event?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_authorisation_events_authorisation_id_fkey"
            columns: ["authorisation_id"]
            isOneToOne: false
            referencedRelation: "onboarding_authorisations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_authorisations: {
        Row: {
          allow_incomplete_sign: boolean
          created_at: string
          expires_at: string
          id: string
          issued_by: string
          max_uses: number
          note: string | null
          purpose: string
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
          trade: string
          uses: number
        }
        Insert: {
          allow_incomplete_sign?: boolean
          created_at?: string
          expires_at: string
          id?: string
          issued_by: string
          max_uses?: number
          note?: string | null
          purpose: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
          trade: string
          uses?: number
        }
        Update: {
          allow_incomplete_sign?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          issued_by?: string
          max_uses?: number
          note?: string | null
          purpose?: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
          trade?: string
          uses?: number
        }
        Relationships: []
      }
      onboarding_limit_clearances: {
        Row: {
          actor: string
          attempts_cleared: number
          created_at: string
          fingerprint_hash: string
          id: number
          kind: string
          reason: string
          trade: string
        }
        Insert: {
          actor: string
          attempts_cleared: number
          created_at?: string
          fingerprint_hash: string
          id?: never
          kind: string
          reason: string
          trade: string
        }
        Update: {
          actor?: string
          attempts_cleared?: number
          created_at?: string
          fingerprint_hash?: string
          id?: never
          kind?: string
          reason?: string
          trade?: string
        }
        Relationships: []
      }
      onboarding_quarantine_uploads: {
        Row: {
          application_id: string
          bytes: number | null
          claim_until: string | null
          cleanup_run_id: number | null
          issued_at: string
          path: string
          resolved_at: string | null
          state: string
        }
        Insert: {
          application_id: string
          bytes?: number | null
          claim_until?: string | null
          cleanup_run_id?: number | null
          issued_at?: string
          path: string
          resolved_at?: string | null
          state?: string
        }
        Update: {
          application_id?: string
          bytes?: number | null
          claim_until?: string | null
          cleanup_run_id?: number | null
          issued_at?: string
          path?: string
          resolved_at?: string | null
          state?: string
        }
        Relationships: []
      }
      onboarding_start_attempts: {
        Row: {
          allowed: boolean
          clearance_id: number | null
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          fingerprint_hash: string
          id: number
          kind: string
          trade: string
        }
        Insert: {
          allowed: boolean
          clearance_id?: number | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          fingerprint_hash: string
          id?: never
          kind: string
          trade: string
        }
        Update: {
          allowed?: boolean
          clearance_id?: number | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          fingerprint_hash?: string
          id?: never
          kind?: string
          trade?: string
        }
        Relationships: []
      }
      onboarding_test_marks: {
        Row: {
          application_id: string
          marked_at: string
          marked_by: string | null
          reason: string
        }
        Insert: {
          application_id: string
          marked_at?: string
          marked_by?: string | null
          reason: string
        }
        Update: {
          application_id?: string
          marked_at?: string
          marked_by?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_test_marks_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_upload_cleanup_runs: {
        Row: {
          actor: string | null
          bytes_removed: number
          created_at: string
          files_removed: number
          id: number
          trigger: string
        }
        Insert: {
          actor?: string | null
          bytes_removed: number
          created_at?: string
          files_removed: number
          id?: never
          trigger: string
        }
        Update: {
          actor?: string | null
          bytes_removed?: number
          created_at?: string
          files_removed?: number
          id?: never
          trigger?: string
        }
        Relationships: []
      }
      outlook_message_work: {
        Row: {
          attachment_refs: Json
          attachments_complete: boolean
          created_at: string
          job_id: string | null
          last_error: string | null
          mailbox: string
          message: Json
          message_at: string
          provider_message_id: string
          record_only: boolean
          result: Json | null
          route: Json
          status: string
          updated_at: string
        }
        Insert: {
          attachment_refs?: Json
          attachments_complete?: boolean
          created_at?: string
          job_id?: string | null
          last_error?: string | null
          mailbox: string
          message: Json
          message_at: string
          provider_message_id: string
          record_only?: boolean
          result?: Json | null
          route: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attachment_refs?: Json
          attachments_complete?: boolean
          created_at?: string
          job_id?: string | null
          last_error?: string | null
          mailbox?: string
          message?: Json
          message_at?: string
          provider_message_id?: string
          record_only?: boolean
          result?: Json | null
          route?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlook_message_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_message_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "outlook_message_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_message_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_message_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      outlook_sync_state: {
        Row: {
          all_inbound_cursor: string | null
          all_inbound_next_link: string | null
          all_outbound_cursor: string | null
          all_outbound_next_link: string | null
          backfill_from: string
          catchup_from: string | null
          catchup_inbound_cursor: string | null
          catchup_inbound_next_link: string | null
          catchup_outbound_cursor: string | null
          catchup_outbound_next_link: string | null
          expected_mailbox: string | null
          id: number
          inbox_cursor: string | null
          inbox_next_link: string | null
          last_counts: Json
          last_error: string | null
          last_ok_at: string | null
          last_run_at: string | null
          mailbox: string | null
          sent_cursor: string | null
          sent_next_link: string | null
          updated_at: string
        }
        Insert: {
          all_inbound_cursor?: string | null
          all_inbound_next_link?: string | null
          all_outbound_cursor?: string | null
          all_outbound_next_link?: string | null
          backfill_from?: string
          catchup_from?: string | null
          catchup_inbound_cursor?: string | null
          catchup_inbound_next_link?: string | null
          catchup_outbound_cursor?: string | null
          catchup_outbound_next_link?: string | null
          expected_mailbox?: string | null
          id?: number
          inbox_cursor?: string | null
          inbox_next_link?: string | null
          last_counts?: Json
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          mailbox?: string | null
          sent_cursor?: string | null
          sent_next_link?: string | null
          updated_at?: string
        }
        Update: {
          all_inbound_cursor?: string | null
          all_inbound_next_link?: string | null
          all_outbound_cursor?: string | null
          all_outbound_next_link?: string | null
          backfill_from?: string
          catchup_from?: string | null
          catchup_inbound_cursor?: string | null
          catchup_inbound_next_link?: string | null
          catchup_outbound_cursor?: string | null
          catchup_outbound_next_link?: string | null
          expected_mailbox?: string | null
          id?: number
          inbox_cursor?: string | null
          inbox_next_link?: string | null
          last_counts?: Json
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          mailbox?: string | null
          sent_cursor?: string | null
          sent_next_link?: string | null
          updated_at?: string
        }
        Relationships: []
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
            foreignKeyName: "owner_authorities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_authorities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            referencedRelation: "office_job_list"
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
            referencedRelation: "office_job_list"
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
      owner_contact_consents: {
        Row: {
          age_confirmed: boolean | null
          assistance: string | null
          consent_key: string
          consent_status: string
          consent_version: string | null
          consented_at: string | null
          contact_consent: boolean | null
          contact_preference: string | null
          created_at: string
          id: string
          job_id: string
          owner_id: string
          sha256: string
          snapshot: Json
          source: string
          source_reference: string | null
        }
        Insert: {
          age_confirmed?: boolean | null
          assistance?: string | null
          consent_key: string
          consent_status: string
          consent_version?: string | null
          consented_at?: string | null
          contact_consent?: boolean | null
          contact_preference?: string | null
          created_at?: string
          id?: string
          job_id: string
          owner_id: string
          sha256: string
          snapshot?: Json
          source?: string
          source_reference?: string | null
        }
        Update: {
          age_confirmed?: boolean | null
          assistance?: string | null
          consent_key?: string
          consent_status?: string
          consent_version?: string | null
          consented_at?: string | null
          contact_consent?: boolean | null
          contact_preference?: string | null
          created_at?: string
          id?: string
          job_id?: string
          owner_id?: string
          sha256?: string
          snapshot?: Json
          source?: string
          source_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_contact_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_contact_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "owner_contact_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_contact_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_contact_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_contact_consents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_contact_consents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_contact_consents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_eligibility_links: {
        Row: {
          answers: Json | null
          business_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          job_id: string
          result: string | null
          result_reasons: Json | null
          revoked_at: string | null
          ruleset_version: string | null
          submitted_at: string | null
          token_hash: string
        }
        Insert: {
          answers?: Json | null
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          job_id: string
          result?: string | null
          result_reasons?: Json | null
          revoked_at?: string | null
          ruleset_version?: string | null
          submitted_at?: string | null
          token_hash: string
        }
        Update: {
          answers?: Json | null
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          job_id?: string
          result?: string | null
          result_reasons?: Json | null
          revoked_at?: string | null
          ruleset_version?: string | null
          submitted_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_eligibility_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_eligibility_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_eligibility_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "owner_eligibility_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_eligibility_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_eligibility_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_esc_consents: {
        Row: {
          ap_ip: string | null
          ap_legal_entity: string
          ap_purpose_explained: boolean | null
          ap_rep: Json | null
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
          owner_declarations: Json | null
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
          ap_rep?: Json | null
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
          owner_declarations?: Json | null
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
          ap_rep?: Json | null
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
          owner_declarations?: Json | null
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
            foreignKeyName: "owner_esc_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_esc_consents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      owner_gate_signatures: {
        Row: {
          answers: Json
          code_id: string | null
          copy_email_queued: boolean
          copy_path: string | null
          doc_draft: boolean
          doc_key: string
          doc_version: string
          gate: string
          id: string
          ip: string | null
          job_id: string
          method: string
          signatory_name: string
          signed_at: string
          signed_by: string | null
          signed_text: string
          signed_text_sha256: string
          ticked: boolean
          user_agent: string | null
          verified_channel: string | null
          verified_destination: string | null
        }
        Insert: {
          answers?: Json
          code_id?: string | null
          copy_email_queued?: boolean
          copy_path?: string | null
          doc_draft: boolean
          doc_key: string
          doc_version: string
          gate: string
          id?: string
          ip?: string | null
          job_id: string
          method: string
          signatory_name: string
          signed_at?: string
          signed_by?: string | null
          signed_text: string
          signed_text_sha256: string
          ticked: boolean
          user_agent?: string | null
          verified_channel?: string | null
          verified_destination?: string | null
        }
        Update: {
          answers?: Json
          code_id?: string | null
          copy_email_queued?: boolean
          copy_path?: string | null
          doc_draft?: boolean
          doc_key?: string
          doc_version?: string
          gate?: string
          id?: string
          ip?: string | null
          job_id?: string
          method?: string
          signatory_name?: string
          signed_at?: string
          signed_by?: string | null
          signed_text?: string
          signed_text_sha256?: string
          ticked?: boolean
          user_agent?: string | null
          verified_channel?: string | null
          verified_destination?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_gate_signatures_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_gate_signatures_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "owner_gate_signatures_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_gate_signatures_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_gate_signatures_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_link_codes: {
        Row: {
          attempts: number
          channel: string
          code_hash: string
          created_at: string
          destination_masked: string
          expires_at: string
          id: string
          job_id: string
          owner_user_id: string | null
          session_expires_at: string | null
          session_hash: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          channel: string
          code_hash: string
          created_at?: string
          destination_masked: string
          expires_at: string
          id?: string
          job_id: string
          owner_user_id?: string | null
          session_expires_at?: string | null
          session_hash?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          code_hash?: string
          created_at?: string
          destination_masked?: string
          expires_at?: string
          id?: string
          job_id?: string
          owner_user_id?: string | null
          session_expires_at?: string | null
          session_hash?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_link_codes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_link_codes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "owner_link_codes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_link_codes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_link_codes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_paperwork_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          body_sha256: string
          doc_key: string
          doc_version: string
          id: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          body_sha256: string
          doc_key: string
          doc_version: string
          id?: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          body_sha256?: string
          doc_key?: string
          doc_version?: string
          id?: string
        }
        Relationships: []
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
      partner_activations: {
        Row: {
          activated_at: string
          activated_by: string
          application_id: string
          business_id: string
          id: string
          override_reason: string | null
          partner_enquiry_id: string
          partner_type: string
          rate_card_id: string
          snapshot: Json
        }
        Insert: {
          activated_at?: string
          activated_by: string
          application_id: string
          business_id: string
          id?: string
          override_reason?: string | null
          partner_enquiry_id: string
          partner_type: string
          rate_card_id: string
          snapshot: Json
        }
        Update: {
          activated_at?: string
          activated_by?: string
          application_id?: string
          business_id?: string
          id?: string
          override_reason?: string | null
          partner_enquiry_id?: string
          partner_type?: string
          rate_card_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "partner_activations_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_activations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_activations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_activations_partner_enquiry_id_fkey"
            columns: ["partner_enquiry_id"]
            isOneToOne: false
            referencedRelation: "partner_enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_activations_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_agreements: {
        Row: {
          body: string
          business_id: string
          created_at: string
          id: string
          ip: string | null
          signed_at: string
          signer_id: string | null
          signer_name: string
          snapshot: Json
          snapshot_sha256: string
          user_agent: string | null
          version: string
        }
        Insert: {
          body: string
          business_id: string
          created_at?: string
          id?: string
          ip?: string | null
          signed_at?: string
          signer_id?: string | null
          signer_name: string
          snapshot: Json
          snapshot_sha256: string
          user_agent?: string | null
          version: string
        }
        Update: {
          body?: string
          business_id?: string
          created_at?: string
          id?: string
          ip?: string | null
          signed_at?: string
          signer_id?: string | null
          signer_name?: string
          snapshot?: Json
          snapshot_sha256?: string
          user_agent?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_agreements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_agreements_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_change_requests: {
        Row: {
          business_id: string
          created_at: string
          id: string
          kind: string
          message: string
          office_note: string | null
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          kind: string
          message: string
          office_note?: string | null
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          kind?: string
          message?: string
          office_note?: string | null
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_change_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          estimated_batts_removal_rate_per_sqm_inc_gst: number | null
          estimated_loose_fill_removal_rate_per_sqm_inc_gst: number | null
          estimated_piesa_fee_inc_gst: number | null
          estimated_r5_install_rate_per_sqm_inc_gst: number | null
          estimated_return_visit_fee_inc_gst: number | null
          esv_licensed_electricians_confirmed: boolean | null
          external_id: string | null
          free_measureups_for_hivic_quote_leads: boolean | null
          free_quotes_for_hivic_leads: boolean | null
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
          estimated_batts_removal_rate_per_sqm_inc_gst?: number | null
          estimated_loose_fill_removal_rate_per_sqm_inc_gst?: number | null
          estimated_piesa_fee_inc_gst?: number | null
          estimated_r5_install_rate_per_sqm_inc_gst?: number | null
          estimated_return_visit_fee_inc_gst?: number | null
          esv_licensed_electricians_confirmed?: boolean | null
          external_id?: string | null
          free_measureups_for_hivic_quote_leads?: boolean | null
          free_quotes_for_hivic_leads?: boolean | null
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
          estimated_batts_removal_rate_per_sqm_inc_gst?: number | null
          estimated_loose_fill_removal_rate_per_sqm_inc_gst?: number | null
          estimated_piesa_fee_inc_gst?: number | null
          estimated_r5_install_rate_per_sqm_inc_gst?: number | null
          estimated_return_visit_fee_inc_gst?: number | null
          esv_licensed_electricians_confirmed?: boolean | null
          external_id?: string | null
          free_measureups_for_hivic_quote_leads?: boolean | null
          free_quotes_for_hivic_leads?: boolean | null
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
      partner_login_links: {
        Row: {
          application_id: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          application_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: []
      }
      partner_measurement_methods: {
        Row: {
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          created_by: string | null
          description: string
          evidence_expected: string | null
          exclusions_rule: string | null
          id: string
          method: string
          status: string
          tools: string | null
          version: string
          zone_breakdown: boolean
        }
        Insert: {
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          description: string
          evidence_expected?: string | null
          exclusions_rule?: string | null
          id?: string
          method: string
          status?: string
          tools?: string | null
          version: string
          zone_breakdown?: boolean
        }
        Update: {
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          evidence_expected?: string | null
          exclusions_rule?: string | null
          id?: string
          method?: string
          status?: string
          tools?: string | null
          version?: string
          zone_breakdown?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "partner_measurement_methods_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_offers: {
        Row: {
          batch: number
          business_id: string
          decline_reason: string | null
          expires_at: string | null
          id: string
          job_id: string
          kind: string
          offered_at: string
          offered_by: string | null
          responded_at: string | null
          responded_by: string | null
          status: string
          summary: Json
          superseded_at: string | null
        }
        Insert: {
          batch?: number
          business_id: string
          decline_reason?: string | null
          expires_at?: string | null
          id?: string
          job_id: string
          kind?: string
          offered_at?: string
          offered_by?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          summary?: Json
          superseded_at?: string | null
        }
        Update: {
          batch?: number
          business_id?: string
          decline_reason?: string | null
          expires_at?: string | null
          id?: string
          job_id?: string
          kind?: string
          offered_at?: string
          offered_by?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          summary?: Json
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_offers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "partner_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offers_offered_by_fkey"
            columns: ["offered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offers_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_quote_proposals: {
        Row: {
          business_id: string
          change_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          job_id: string
          lines: Json
          notes: string | null
          rate_card_id: string | null
          snapshot_sha256: string
          status: string
          supplier_total_ex_gst: number
          version: number
        }
        Insert: {
          business_id: string
          change_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_id: string
          lines?: Json
          notes?: string | null
          rate_card_id?: string | null
          snapshot_sha256: string
          status?: string
          supplier_total_ex_gst?: number
          version?: number
        }
        Update: {
          business_id?: string
          change_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string
          lines?: Json
          notes?: string | null
          rate_card_id?: string | null
          snapshot_sha256?: string
          status?: string
          supplier_total_ex_gst?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "partner_quote_proposals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_quote_proposals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_quote_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_quote_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "partner_quote_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_quote_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_quote_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_quote_proposals_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_rate_offers: {
        Row: {
          application_id: string
          code_attempts: number
          code_expires_at: string | null
          code_hash: string | null
          created_at: string
          created_by: string
          expires_at: string | null
          gst_registered: boolean
          id: string
          items: Json
          link_reissued_at: string | null
          note: string | null
          responded_at: string | null
          response: Json | null
          round: number
          status: string
          token_hash: string
        }
        Insert: {
          application_id: string
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          created_by: string
          expires_at?: string | null
          gst_registered: boolean
          id?: string
          items: Json
          link_reissued_at?: string | null
          note?: string | null
          responded_at?: string | null
          response?: Json | null
          round: number
          status?: string
          token_hash: string
        }
        Update: {
          application_id?: string
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string | null
          gst_registered?: boolean
          id?: string
          items?: Json
          link_reissued_at?: string | null
          note?: string | null
          responded_at?: string | null
          response?: Json | null
          round?: number
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_rate_offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_relationships: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          electrician_business_id: string
          id: string
          installer_business_id: string
          is_primary: boolean
          notes: string | null
          preferred: boolean
          source: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          electrician_business_id: string
          id?: string
          installer_business_id: string
          is_primary?: boolean
          notes?: string | null
          preferred?: boolean
          source?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          electrician_business_id?: string
          id?: string
          installer_business_id?: string
          is_primary?: boolean
          notes?: string | null
          preferred?: boolean
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_relationships_electrician_business_id_fkey"
            columns: ["electrician_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_relationships_installer_business_id_fkey"
            columns: ["installer_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_worker_certifications: {
        Row: {
          application_id: string | null
          certificate_number: string | null
          evidence_note: string
          evidence_source: string
          id: string
          issuer: string | null
          recorded_at: string
          recorded_by: string
          status: string
          worker_email: string
          worker_id: string | null
        }
        Insert: {
          application_id?: string | null
          certificate_number?: string | null
          evidence_note: string
          evidence_source: string
          id?: string
          issuer?: string | null
          recorded_at?: string
          recorded_by: string
          status: string
          worker_email: string
          worker_id?: string | null
        }
        Update: {
          application_id?: string | null
          certificate_number?: string | null
          evidence_note?: string
          evidence_source?: string
          id?: string
          issuer?: string | null
          recorded_at?: string
          recorded_by?: string
          status?: string
          worker_email?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_worker_certifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "rec_onboarding_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_worker_certifications_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "partner_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_worker_invites: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          declarations: Json | null
          expires_at: string
          id: string
          invitee_contact: string | null
          invitee_name: string
          is_test: boolean
          revoked_at: string | null
          signed_ip: string | null
          signed_name: string | null
          signed_user_agent: string | null
          token_hash: string
          trade_role: Database["public"]["Enums"]["assignment_role"]
          used_at: string | null
          worker_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          declarations?: Json | null
          expires_at: string
          id?: string
          invitee_contact?: string | null
          invitee_name: string
          is_test?: boolean
          revoked_at?: string | null
          signed_ip?: string | null
          signed_name?: string | null
          signed_user_agent?: string | null
          token_hash: string
          trade_role: Database["public"]["Enums"]["assignment_role"]
          used_at?: string | null
          worker_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          declarations?: Json | null
          expires_at?: string
          id?: string
          invitee_contact?: string | null
          invitee_name?: string
          is_test?: boolean
          revoked_at?: string | null
          signed_ip?: string | null
          signed_name?: string | null
          signed_user_agent?: string | null
          token_hash?: string
          trade_role?: Database["public"]["Enums"]["assignment_role"]
          used_at?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_worker_invites_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_worker_invites_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "partner_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_workers: {
        Row: {
          account_status: string
          added_by: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          business_id: string
          certification: Json | null
          certification_status: string | null
          created_at: string
          email: string
          full_legal_name: string
          id: string
          licence_expires_on: string | null
          licence_number: string | null
          linked_at: string | null
          linked_by: string | null
          mobile: string | null
          piisa_certificate_path: string | null
          piisa_completed_on: string | null
          piisa_status: string | null
          piisa_verified_at: string | null
          piisa_verified_by: string | null
          profile_id: string | null
          qualification: string | null
          rejection_reason: string | null
          removed_at: string | null
          source_application_id: string | null
          trade_role: Database["public"]["Enums"]["assignment_role"]
          updated_at: string
        }
        Insert: {
          account_status?: string
          added_by?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          certification?: Json | null
          certification_status?: string | null
          created_at?: string
          email: string
          full_legal_name: string
          id?: string
          licence_expires_on?: string | null
          licence_number?: string | null
          linked_at?: string | null
          linked_by?: string | null
          mobile?: string | null
          piisa_certificate_path?: string | null
          piisa_completed_on?: string | null
          piisa_status?: string | null
          piisa_verified_at?: string | null
          piisa_verified_by?: string | null
          profile_id?: string | null
          qualification?: string | null
          rejection_reason?: string | null
          removed_at?: string | null
          source_application_id?: string | null
          trade_role: Database["public"]["Enums"]["assignment_role"]
          updated_at?: string
        }
        Update: {
          account_status?: string
          added_by?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          certification?: Json | null
          certification_status?: string | null
          created_at?: string
          email?: string
          full_legal_name?: string
          id?: string
          licence_expires_on?: string | null
          licence_number?: string | null
          linked_at?: string | null
          linked_by?: string | null
          mobile?: string | null
          piisa_certificate_path?: string | null
          piisa_completed_on?: string | null
          piisa_status?: string | null
          piisa_verified_at?: string | null
          piisa_verified_by?: string | null
          profile_id?: string | null
          qualification?: string | null
          rejection_reason?: string | null
          removed_at?: string | null
          source_application_id?: string | null
          trade_role?: Database["public"]["Enums"]["assignment_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_workers_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_workers_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_workers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_workers_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_workers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_workers_source_application_id_fkey"
            columns: ["source_application_id"]
            isOneToOne: false
            referencedRelation: "rec_onboarding_applications"
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
            foreignKeyName: "payment_overrides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_overrides_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            foreignKeyName: "piesa_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      piesa_reconciliations: {
        Row: {
          actual_items: Json
          actual_total_inc_gst: number
          allowance_snapshot_id: string
          created_at: string
          created_by: string | null
          id: string
          job_id: string
          outcome: string
          preliminary_total_inc_gst: number
          priced_lines: Json
          reason: string
          requires_customer_approval: boolean
          unmatched_items: Json
          variance_inc_gst: number
        }
        Insert: {
          actual_items: Json
          actual_total_inc_gst: number
          allowance_snapshot_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id: string
          outcome: string
          preliminary_total_inc_gst: number
          priced_lines: Json
          reason: string
          requires_customer_approval: boolean
          unmatched_items?: Json
          variance_inc_gst: number
        }
        Update: {
          actual_items?: Json
          actual_total_inc_gst?: number
          allowance_snapshot_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string
          outcome?: string
          preliminary_total_inc_gst?: number
          priced_lines?: Json
          reason?: string
          requires_customer_approval?: boolean
          unmatched_items?: Json
          variance_inc_gst?: number
        }
        Relationships: [
          {
            foreignKeyName: "piesa_reconciliations_allowance_snapshot_id_fkey"
            columns: ["allowance_snapshot_id"]
            isOneToOne: false
            referencedRelation: "electrical_allowance_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_reconciliations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_reconciliations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "piesa_reconciliations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_reconciliations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_reconciliations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          rectification_completed_at: string | null
          section_c_signed_at: string | null
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
          rectification_completed_at?: string | null
          section_c_signed_at?: string | null
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
          rectification_completed_at?: string | null
          section_c_signed_at?: string | null
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
            foreignKeyName: "piesa_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piesa_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      post_intake_work: {
        Row: {
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          facts_version: string
          id: string
          job_id: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          reason: string | null
          status: string
          updated_at: string
          work_type: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          facts_version: string
          id?: string
          job_id: string
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          work_type?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          facts_version?: string
          id?: string
          job_id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_intake_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_intake_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "post_intake_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_intake_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_intake_work_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_start_checks: {
        Row: {
          booking_id: string | null
          checked_at: string
          failures: Json
          id: string
          job_id: string
          passed: boolean
          scheduled_start: string
          trigger: string
        }
        Insert: {
          booking_id?: string | null
          checked_at?: string
          failures?: Json
          id?: string
          job_id: string
          passed: boolean
          scheduled_start: string
          trigger: string
        }
        Update: {
          booking_id?: string | null
          checked_at?: string
          failures?: Json
          id?: string
          job_id?: string
          passed?: boolean
          scheduled_start?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "pre_start_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_start_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "pre_start_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_start_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_start_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          piesa_rec_cost_ex_gst: number | null
          veec_credit_per_m2_inc_gst: number
          veec_lodgement_fee_ex_gst: number | null
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
          piesa_rec_cost_ex_gst?: number | null
          veec_credit_per_m2_inc_gst?: number
          veec_lodgement_fee_ex_gst?: number | null
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
          piesa_rec_cost_ex_gst?: number | null
          veec_credit_per_m2_inc_gst?: number
          veec_lodgement_fee_ex_gst?: number | null
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
          mitti_checked_at: string | null
          mitti_checked_email: string | null
          mitti_user_id: string | null
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
          mitti_checked_at?: string | null
          mitti_checked_email?: string | null
          mitti_user_id?: string | null
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
          mitti_checked_at?: string | null
          mitti_checked_email?: string | null
          mitti_user_id?: string | null
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
            referencedRelation: "office_job_list"
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
            foreignKeyName: "property_area_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_area_estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            referencedRelation: "office_job_list"
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
            foreignKeyName: "property_facts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_facts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            referencedRelation: "office_job_list"
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
            foreignKeyName: "property_floorplans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_floorplans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            referencedRelation: "office_job_list"
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
            foreignKeyName: "property_intelligence_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_intelligence_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            referencedRelation: "office_job_list"
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
            foreignKeyName: "property_source_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_source_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          cobrand: Json | null
          created_at: string
          created_by: string | null
          customer_total_inc_gst: number
          discount_note: string | null
          expired_at: string | null
          gst_amount: number
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["quote_kind"]
          manually_adjusted: boolean
          nudge_24h_at: string | null
          nudge_day10_at: string | null
          nudge_day3_at: string | null
          office_reviewed_at: string | null
          office_reviewed_by: string | null
          option_code: string | null
          option_label: string
          partner_business_id: string | null
          prices_include_gst: boolean
          pricing_settings_id: string | null
          rate_card_id: string | null
          rect_estimated_hours: number | null
          release_hold_reason: string | null
          release_state: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal_inc_gst: number
          veec_count: number | null
          veec_discount_inc_gst: number
          veec_unit_value_inc_gst: number | null
          version: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cobrand?: Json | null
          created_at?: string
          created_by?: string | null
          customer_total_inc_gst: number
          discount_note?: string | null
          expired_at?: string | null
          gst_amount: number
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["quote_kind"]
          manually_adjusted?: boolean
          nudge_24h_at?: string | null
          nudge_day10_at?: string | null
          nudge_day3_at?: string | null
          office_reviewed_at?: string | null
          office_reviewed_by?: string | null
          option_code?: string | null
          option_label: string
          partner_business_id?: string | null
          prices_include_gst?: boolean
          pricing_settings_id?: string | null
          rate_card_id?: string | null
          rect_estimated_hours?: number | null
          release_hold_reason?: string | null
          release_state?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_inc_gst: number
          veec_count?: number | null
          veec_discount_inc_gst?: number
          veec_unit_value_inc_gst?: number | null
          version?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cobrand?: Json | null
          created_at?: string
          created_by?: string | null
          customer_total_inc_gst?: number
          discount_note?: string | null
          expired_at?: string | null
          gst_amount?: number
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["quote_kind"]
          manually_adjusted?: boolean
          nudge_24h_at?: string | null
          nudge_day10_at?: string | null
          nudge_day3_at?: string | null
          office_reviewed_at?: string | null
          office_reviewed_by?: string | null
          option_code?: string | null
          option_label?: string
          partner_business_id?: string | null
          prices_include_gst?: boolean
          pricing_settings_id?: string | null
          rate_card_id?: string | null
          rect_estimated_hours?: number | null
          release_hold_reason?: string | null
          release_state?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_inc_gst?: number
          veec_count?: number | null
          veec_discount_inc_gst?: number
          veec_unit_value_inc_gst?: number | null
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
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_office_reviewed_by_fkey"
            columns: ["office_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_partner_business_id_fkey"
            columns: ["partner_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          display_unit: string | null
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
          display_unit?: string | null
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
          display_unit?: string | null
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
      ready_check_acceptances: {
        Row: {
          accepted_at: string
          accepted_ip: unknown
          accepted_user_agent: string | null
          copy_version: string
          cost_after_discount_inc_gst: number
          estimate_id: string
          estimate_input_signature: string
          estimate_settings_version: number
          estimated_discount_inc_gst: number
          estimated_remaining_balance_inc_gst: number
          id: string
          job_id: string
          ready_check_amount_inc_gst: number
          snapshot: Json
        }
        Insert: {
          accepted_at?: string
          accepted_ip?: unknown
          accepted_user_agent?: string | null
          copy_version: string
          cost_after_discount_inc_gst: number
          estimate_id: string
          estimate_input_signature: string
          estimate_settings_version: number
          estimated_discount_inc_gst: number
          estimated_remaining_balance_inc_gst: number
          id?: string
          job_id: string
          ready_check_amount_inc_gst: number
          snapshot: Json
        }
        Update: {
          accepted_at?: string
          accepted_ip?: unknown
          accepted_user_agent?: string | null
          copy_version?: string
          cost_after_discount_inc_gst?: number
          estimate_id?: string
          estimate_input_signature?: string
          estimate_settings_version?: number
          estimated_discount_inc_gst?: number
          estimated_remaining_balance_inc_gst?: number
          id?: string
          job_id?: string
          ready_check_amount_inc_gst?: number
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ready_check_acceptances_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "indicative_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "ready_check_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_acceptances_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_check_observations: {
        Row: {
          evidence_document_ids: string[]
          field_key: string
          id: string
          job_id: string
          ready_check_id: string
          recorded_at: string
          recorded_by: string | null
          value: Json | null
        }
        Insert: {
          evidence_document_ids?: string[]
          field_key: string
          id?: string
          job_id: string
          ready_check_id: string
          recorded_at?: string
          recorded_by?: string | null
          value?: Json | null
        }
        Update: {
          evidence_document_ids?: string[]
          field_key?: string
          id?: string
          job_id?: string
          ready_check_id?: string
          recorded_at?: string
          recorded_by?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ready_check_observations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_observations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "ready_check_observations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_observations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_observations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_observations_ready_check_id_fkey"
            columns: ["ready_check_id"]
            isOneToOne: false
            referencedRelation: "ready_checks"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_check_payment_attempts: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          job_id: string
          outcome: string
          payment_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          job_id: string
          outcome: string
          payment_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          job_id?: string
          outcome?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ready_check_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "ready_check_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payment_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payment_attempts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "ready_check_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_check_payments: {
        Row: {
          acceptance_id: string
          amount_inc_gst: number
          attempt_count: number
          created_at: string
          credit_applied_to_quote_id: string | null
          failed_at: string | null
          id: string
          job_id: string
          mode: string
          paid_at: string | null
          purpose: string
          status: string
          updated_at: string
        }
        Insert: {
          acceptance_id: string
          amount_inc_gst: number
          attempt_count?: number
          created_at?: string
          credit_applied_to_quote_id?: string | null
          failed_at?: string | null
          id?: string
          job_id: string
          mode?: string
          paid_at?: string | null
          purpose?: string
          status?: string
          updated_at?: string
        }
        Update: {
          acceptance_id?: string
          amount_inc_gst?: number
          attempt_count?: number
          created_at?: string
          credit_applied_to_quote_id?: string | null
          failed_at?: string | null
          id?: string
          job_id?: string
          mode?: string
          paid_at?: string | null
          purpose?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ready_check_payments_acceptance_id_fkey"
            columns: ["acceptance_id"]
            isOneToOne: true
            referencedRelation: "ready_check_acceptances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "ready_check_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_check_windows: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          job_id: string
          round: number
          starts_at: string
          status: string
          taken_at: string | null
          taken_by: string | null
          taken_offer_id: string | null
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          job_id: string
          round: number
          starts_at: string
          status?: string
          taken_at?: string | null
          taken_by?: string | null
          taken_offer_id?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          job_id?: string
          round?: number
          starts_at?: string
          status?: string
          taken_at?: string | null
          taken_by?: string | null
          taken_offer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ready_check_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "ready_check_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_check_windows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_checks: {
        Row: {
          attended_at: string | null
          created_at: string
          external_mitti_id: string | null
          id: string
          installer_business_id: string | null
          installer_user_id: string | null
          job_id: string
          status: string
          submitted_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          attended_at?: string | null
          created_at?: string
          external_mitti_id?: string | null
          id?: string
          installer_business_id?: string | null
          installer_user_id?: string | null
          job_id: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          attended_at?: string | null
          created_at?: string
          external_mitti_id?: string | null
          id?: string
          installer_business_id?: string | null
          installer_user_id?: string | null
          job_id?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ready_checks_installer_business_id_fkey"
            columns: ["installer_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "ready_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            foreignKeyName: "reassignment_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reassignment_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
      rec_onboarding_applications: {
        Row: {
          acknowledgements: Json | null
          agreement_sha256: string | null
          agreement_text: string | null
          agreement_title: string | null
          agreement_version: string | null
          allow_incomplete_sign: boolean
          authorisation_id: string | null
          contact_hash: string | null
          created_at: string
          data: Json
          id: string
          insurance_certificate_path: string | null
          insurance_file_bytes: number | null
          insurance_file_sha256: string | null
          insurance_file_type: string | null
          insurance_scan_result: string | null
          insurance_verified_at: string | null
          partner_enquiry_id: string | null
          partner_type: string
          resume_token_hash: string
          signed_at: string | null
          signed_ip: string | null
          signed_user_agent: string | null
          signer_email: string | null
          signer_name: string | null
          signer_position: string | null
          status: string
          step_key: string | null
          test_mode: boolean
          updated_at: string
        }
        Insert: {
          acknowledgements?: Json | null
          agreement_sha256?: string | null
          agreement_text?: string | null
          agreement_title?: string | null
          agreement_version?: string | null
          allow_incomplete_sign?: boolean
          authorisation_id?: string | null
          contact_hash?: string | null
          created_at?: string
          data?: Json
          id?: string
          insurance_certificate_path?: string | null
          insurance_file_bytes?: number | null
          insurance_file_sha256?: string | null
          insurance_file_type?: string | null
          insurance_scan_result?: string | null
          insurance_verified_at?: string | null
          partner_enquiry_id?: string | null
          partner_type?: string
          resume_token_hash: string
          signed_at?: string | null
          signed_ip?: string | null
          signed_user_agent?: string | null
          signer_email?: string | null
          signer_name?: string | null
          signer_position?: string | null
          status?: string
          step_key?: string | null
          test_mode?: boolean
          updated_at?: string
        }
        Update: {
          acknowledgements?: Json | null
          agreement_sha256?: string | null
          agreement_text?: string | null
          agreement_title?: string | null
          agreement_version?: string | null
          allow_incomplete_sign?: boolean
          authorisation_id?: string | null
          contact_hash?: string | null
          created_at?: string
          data?: Json
          id?: string
          insurance_certificate_path?: string | null
          insurance_file_bytes?: number | null
          insurance_file_sha256?: string | null
          insurance_file_type?: string | null
          insurance_scan_result?: string | null
          insurance_verified_at?: string | null
          partner_enquiry_id?: string | null
          partner_type?: string
          resume_token_hash?: string
          signed_at?: string | null
          signed_ip?: string | null
          signed_user_agent?: string | null
          signer_email?: string | null
          signer_name?: string | null
          signer_position?: string | null
          status?: string
          step_key?: string | null
          test_mode?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_onboarding_applications_authorisation_id_fkey"
            columns: ["authorisation_id"]
            isOneToOne: false
            referencedRelation: "onboarding_authorisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rec_onboarding_applications_partner_enquiry_id_fkey"
            columns: ["partner_enquiry_id"]
            isOneToOne: false
            referencedRelation: "partner_enquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_rate_card_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          rate_card_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          rate_card_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          rate_card_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_rate_card_events_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rec_rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_rate_card_items: {
        Row: {
          code: string
          conservative_quantity: number | null
          created_at: string
          description: string
          id: string
          internal_cost_ex_gst: number | null
          quantity_source: string | null
          rate_card_id: string
          rate_inc_gst: number | null
          rule_kind: string
          trigger_key: string
          trigger_value: Json | null
          unit: string
        }
        Insert: {
          code: string
          conservative_quantity?: number | null
          created_at?: string
          description: string
          id?: string
          internal_cost_ex_gst?: number | null
          quantity_source?: string | null
          rate_card_id: string
          rate_inc_gst?: number | null
          rule_kind: string
          trigger_key: string
          trigger_value?: Json | null
          unit: string
        }
        Update: {
          code?: string
          conservative_quantity?: number | null
          created_at?: string
          description?: string
          id?: string
          internal_cost_ex_gst?: number | null
          quantity_source?: string | null
          rate_card_id?: string
          rate_inc_gst?: number | null
          rule_kind?: string
          trigger_key?: string
          trigger_value?: Json | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "rec_rate_card_items_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rec_rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      rec_rate_cards: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          notes: string | null
          provider_business_id: string | null
          test_only: boolean
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          notes?: string | null
          provider_business_id?: string | null
          test_only?: boolean
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          notes?: string | null
          provider_business_id?: string | null
          test_only?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rec_rate_cards_provider_business_id_fkey"
            columns: ["provider_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          {
            foreignKeyName: "rectification_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rectification_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_estimator_settings: {
        Row: {
          access_difficult_multiplier: number
          access_moderate_multiplier: number
          access_standard_multiplier: number
          ap_management_inc_gst: number
          created_at: string
          created_by: string | null
          id: string
          indicative_veec_value: number
          is_current: boolean
          max_discount_metro_inc_gst: number
          max_discount_regional_inc_gst: number
          minimum_customer_copayment_inc_gst: number
          notes: string | null
          piesa_assessment_inc_gst: number
          r5_install_inc_gst_per_m2: number
          removal_inc_gst_per_m2: number
          spec_source_url: string
          spec_version: string
          veec_buy_price: number
          veec_value_checked_at: string
          veec_value_source_label: string
          veec_value_source_url: string
          version: number
        }
        Insert: {
          access_difficult_multiplier: number
          access_moderate_multiplier: number
          access_standard_multiplier: number
          ap_management_inc_gst: number
          created_at?: string
          created_by?: string | null
          id?: string
          indicative_veec_value: number
          is_current?: boolean
          max_discount_metro_inc_gst?: number
          max_discount_regional_inc_gst?: number
          minimum_customer_copayment_inc_gst: number
          notes?: string | null
          piesa_assessment_inc_gst: number
          r5_install_inc_gst_per_m2: number
          removal_inc_gst_per_m2: number
          spec_source_url: string
          spec_version: string
          veec_buy_price?: number
          veec_value_checked_at: string
          veec_value_source_label: string
          veec_value_source_url: string
          version: number
        }
        Update: {
          access_difficult_multiplier?: number
          access_moderate_multiplier?: number
          access_standard_multiplier?: number
          ap_management_inc_gst?: number
          created_at?: string
          created_by?: string | null
          id?: string
          indicative_veec_value?: number
          is_current?: boolean
          max_discount_metro_inc_gst?: number
          max_discount_regional_inc_gst?: number
          minimum_customer_copayment_inc_gst?: number
          notes?: string | null
          piesa_assessment_inc_gst?: number
          r5_install_inc_gst_per_m2?: number
          removal_inc_gst_per_m2?: number
          spec_source_url?: string
          spec_version?: string
          veec_buy_price?: number
          veec_value_checked_at?: string
          veec_value_source_label?: string
          veec_value_source_url?: string
          version?: number
        }
        Relationships: []
      }
      signed_webhook_nonces: {
        Row: {
          id: string
          nonce: string
          purpose: string
          received_at: string
          signed_at: string | null
          source: string
        }
        Insert: {
          id?: string
          nonce: string
          purpose: string
          received_at?: string
          signed_at?: string | null
          source: string
        }
        Update: {
          id?: string
          nonce?: string
          purpose?: string
          received_at?: string
          signed_at?: string | null
          source?: string
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          body: string
          business_id: string | null
          created_at: string
          detail: string | null
          from_sender: string | null
          id: string
          idempotency_key: string
          job_id: string | null
          message_type: string
          provider_sid: string | null
          status: string
          status_updated_at: string | null
          to_number: string
          updated_at: string
        }
        Insert: {
          body: string
          business_id?: string | null
          created_at?: string
          detail?: string | null
          from_sender?: string | null
          id?: string
          idempotency_key: string
          job_id?: string | null
          message_type: string
          provider_sid?: string | null
          status: string
          status_updated_at?: string | null
          to_number: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string | null
          created_at?: string
          detail?: string | null
          from_sender?: string | null
          id?: string
          idempotency_key?: string
          job_id?: string | null
          message_type?: string
          provider_sid?: string | null
          status?: string
          status_updated_at?: string | null
          to_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "sms_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_optouts: {
        Row: {
          last_message: string | null
          opted_in_at: string | null
          opted_out_at: string
          phone: string
          source: string
        }
        Insert: {
          last_message?: string | null
          opted_in_at?: string | null
          opted_out_at?: string
          phone: string
          source?: string
        }
        Update: {
          last_message?: string | null
          opted_in_at?: string | null
          opted_out_at?: string
          phone?: string
          source?: string
        }
        Relationships: []
      }
      trade_text_log: {
        Row: {
          acknowledged_at: string | null
          body: string | null
          business_id: string
          created_at: string
          detail: string | null
          id: string
          job_ids: string[]
          kind: string
          melbourne_date: string
          provider_sid: string | null
          send_key: string
          snapshot: Json
          status: string
          to_number: string | null
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          body?: string | null
          business_id: string
          created_at?: string
          detail?: string | null
          id?: string
          job_ids?: string[]
          kind: string
          melbourne_date: string
          provider_sid?: string | null
          send_key: string
          snapshot?: Json
          status: string
          to_number?: string | null
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          body?: string | null
          business_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          job_ids?: string[]
          kind?: string
          melbourne_date?: string
          provider_sid?: string | null
          send_key?: string
          snapshot?: Json
          status?: string
          to_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_text_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          query_received_at: string | null
          query_text: string | null
          reply_draft: string | null
          reply_sent_at: string | null
          reply_sent_by: string | null
          sale_price_per_veec: number | null
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
          query_received_at?: string | null
          query_text?: string | null
          reply_draft?: string | null
          reply_sent_at?: string | null
          reply_sent_by?: string | null
          sale_price_per_veec?: number | null
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
          query_received_at?: string | null
          query_text?: string | null
          reply_draft?: string | null
          reply_sent_at?: string | null
          reply_sent_by?: string | null
          sale_price_per_veec?: number | null
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
          {
            foreignKeyName: "veec_lodgements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "veec_lodgements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      veec_spot_prices: {
        Row: {
          created_at: string
          id: string
          note: string | null
          price: number
          priced_on: string
          recorded_by: string | null
          source: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          price: number
          priced_on?: string
          recorded_by?: string | null
          source?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          price?: number
          priced_on?: string
          recorded_by?: string | null
          source?: string | null
        }
        Relationships: []
      }
      veu_location_variables: {
        Row: {
          climate_region: string
          climate_zone: number | null
          created_at: string
          metropolitan_or_regional: string
          postcode: string
          reticulated_gas: boolean | null
          source_sha256: string | null
          source_url: string
          source_version: string
        }
        Insert: {
          climate_region: string
          climate_zone?: number | null
          created_at?: string
          metropolitan_or_regional: string
          postcode: string
          reticulated_gas?: boolean | null
          source_sha256?: string | null
          source_url: string
          source_version: string
        }
        Update: {
          climate_region?: string
          climate_zone?: number | null
          created_at?: string
          metropolitan_or_regional?: string
          postcode?: string
          reticulated_gas?: boolean | null
          source_sha256?: string | null
          source_url?: string
          source_version?: string
        }
        Relationships: []
      }
      visit_events: {
        Row: {
          actor_id: string | null
          booking_id: string | null
          business_id: string | null
          clears_event_id: string | null
          counts_against: string
          created_at: string
          event: string
          id: string
          job_id: string
          reason: string | null
          visit_kind: Database["public"]["Enums"]["booking_kind"] | null
        }
        Insert: {
          actor_id?: string | null
          booking_id?: string | null
          business_id?: string | null
          clears_event_id?: string | null
          counts_against?: string
          created_at?: string
          event: string
          id?: string
          job_id: string
          reason?: string | null
          visit_kind?: Database["public"]["Enums"]["booking_kind"] | null
        }
        Update: {
          actor_id?: string | null
          booking_id?: string | null
          business_id?: string | null
          clears_event_id?: string | null
          counts_against?: string
          created_at?: string
          event?: string
          id?: string
          job_id?: string
          reason?: string | null
          visit_kind?: Database["public"]["Enums"]["booking_kind"] | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_events_clears_event_id_fkey"
            columns: ["clears_event_id"]
            isOneToOne: false
            referencedRelation: "visit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "visit_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_access_attempts: {
        Row: {
          at: string
          event_type: string
          id: string
          invite_id: string | null
        }
        Insert: {
          at?: string
          event_type: string
          id?: string
          invite_id?: string | null
        }
        Update: {
          at?: string
          event_type?: string
          id?: string
          invite_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_access_attempts_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "partner_worker_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_access_budgets: {
        Row: {
          bucket: string
          key_hash: string
          requests: number
        }
        Insert: {
          bucket: string
          key_hash: string
          requests?: number
        }
        Update: {
          bucket?: string
          key_hash?: string
          requests?: number
        }
        Relationships: []
      }
      worker_certification_levels: {
        Row: {
          certification_id: string
          expires_on: string
          id: string
          level: string
          recorded_at: string
          recorded_by: string
          worker_email: string
        }
        Insert: {
          certification_id: string
          expires_on: string
          id?: string
          level: string
          recorded_at?: string
          recorded_by: string
          worker_email: string
        }
        Update: {
          certification_id?: string
          expires_on?: string
          id?: string
          level?: string
          recorded_at?: string
          recorded_by?: string
          worker_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_certification_levels_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "partner_worker_certifications"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_job_links: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          job_id: string
          last_opened_at: string | null
          open_count: number
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
          worker_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          job_id: string
          last_opened_at?: string | null
          open_count?: number
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
          worker_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          job_id?: string
          last_opened_at?: string | null
          open_count?: number
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_job_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_job_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_job_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_job_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_piesa_deadlines"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "worker_job_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_job_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_job_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_job_links_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_job_links_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "partner_workers"
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
          job_id: string | null
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
          job_id?: string | null
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
          job_id?: string | null
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
          {
            foreignKeyName: "workflow_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_settings: {
        Row: {
          authority_validity_months: number
          auto_electrician_offers: boolean
          auto_installer_offers: boolean
          auto_send_installer: boolean
          auto_send_mitti: boolean
          auto_send_quote: boolean
          auto_send_rec: boolean
          current_veec_price: number
          customer_comms_enabled: boolean
          daily_mitti_text_enabled: boolean
          daily_mitti_text_time: string
          due_owner_flag_days: number
          due_owner_reminder_days: number
          due_trade_reply_exception_hours: number
          due_trade_reply_warn_hours: number
          id: number
          installer_quote_max_inc_gst_per_m2: number | null
          installer_quote_min_inc_gst_per_m2: number | null
          measurement_standard_approved: boolean
          measurement_standard_approved_at: string | null
          measurement_standard_approved_by: string | null
          measurement_standard_version: string | null
          measurement_variance_tolerance_pct: number | null
          min_building_age_years: number
          mitti_auto_quote_enabled: boolean
          mitti_measureup_template_id: string | null
          mitti_pickup_auto_enabled: boolean
          mitti_piesa_template_id: string | null
          mitti_piisa_template_id: string | null
          mitti_ready_check_priced_template_id: string | null
          mitti_ready_check_template_id: string | null
          offer_dispatch_mode: string
          offer_suggest_time_after_hours: number
          office_time_limits: Json
          owner_resign_after_install: boolean
          partner_lead_fee_inc_gst: number
          payment_option_gate_enabled: boolean
          photo_max_distance_m: number
          piesa_install_window_days: number
          quote_estimate_variance_tolerance_pct: number
          ready_check_booking_enabled: boolean
          rec_offer_batch_size: number
          rec_offer_business_hours: number
          rec_offer_expiry_hours: number
          safety_check_payment_inc_gst: number
          save_my_spot_auto_rules: Json
          save_my_spot_real_send_enabled: boolean
          sms_message_switches: Json
          updated_at: string
          urgency_amber_days: number
          urgency_red_days: number
        }
        Insert: {
          authority_validity_months?: number
          auto_electrician_offers?: boolean
          auto_installer_offers?: boolean
          auto_send_installer?: boolean
          auto_send_mitti?: boolean
          auto_send_quote?: boolean
          auto_send_rec?: boolean
          current_veec_price?: number
          customer_comms_enabled?: boolean
          daily_mitti_text_enabled?: boolean
          daily_mitti_text_time?: string
          due_owner_flag_days?: number
          due_owner_reminder_days?: number
          due_trade_reply_exception_hours?: number
          due_trade_reply_warn_hours?: number
          id?: number
          installer_quote_max_inc_gst_per_m2?: number | null
          installer_quote_min_inc_gst_per_m2?: number | null
          measurement_standard_approved?: boolean
          measurement_standard_approved_at?: string | null
          measurement_standard_approved_by?: string | null
          measurement_standard_version?: string | null
          measurement_variance_tolerance_pct?: number | null
          min_building_age_years?: number
          mitti_auto_quote_enabled?: boolean
          mitti_measureup_template_id?: string | null
          mitti_pickup_auto_enabled?: boolean
          mitti_piesa_template_id?: string | null
          mitti_piisa_template_id?: string | null
          mitti_ready_check_priced_template_id?: string | null
          mitti_ready_check_template_id?: string | null
          offer_dispatch_mode?: string
          offer_suggest_time_after_hours?: number
          office_time_limits?: Json
          owner_resign_after_install?: boolean
          partner_lead_fee_inc_gst?: number
          payment_option_gate_enabled?: boolean
          photo_max_distance_m?: number
          piesa_install_window_days?: number
          quote_estimate_variance_tolerance_pct?: number
          ready_check_booking_enabled?: boolean
          rec_offer_batch_size?: number
          rec_offer_business_hours?: number
          rec_offer_expiry_hours?: number
          safety_check_payment_inc_gst?: number
          save_my_spot_auto_rules?: Json
          save_my_spot_real_send_enabled?: boolean
          sms_message_switches?: Json
          updated_at?: string
          urgency_amber_days?: number
          urgency_red_days?: number
        }
        Update: {
          authority_validity_months?: number
          auto_electrician_offers?: boolean
          auto_installer_offers?: boolean
          auto_send_installer?: boolean
          auto_send_mitti?: boolean
          auto_send_quote?: boolean
          auto_send_rec?: boolean
          current_veec_price?: number
          customer_comms_enabled?: boolean
          daily_mitti_text_enabled?: boolean
          daily_mitti_text_time?: string
          due_owner_flag_days?: number
          due_owner_reminder_days?: number
          due_trade_reply_exception_hours?: number
          due_trade_reply_warn_hours?: number
          id?: number
          installer_quote_max_inc_gst_per_m2?: number | null
          installer_quote_min_inc_gst_per_m2?: number | null
          measurement_standard_approved?: boolean
          measurement_standard_approved_at?: string | null
          measurement_standard_approved_by?: string | null
          measurement_standard_version?: string | null
          measurement_variance_tolerance_pct?: number | null
          min_building_age_years?: number
          mitti_auto_quote_enabled?: boolean
          mitti_measureup_template_id?: string | null
          mitti_pickup_auto_enabled?: boolean
          mitti_piesa_template_id?: string | null
          mitti_piisa_template_id?: string | null
          mitti_ready_check_priced_template_id?: string | null
          mitti_ready_check_template_id?: string | null
          offer_dispatch_mode?: string
          offer_suggest_time_after_hours?: number
          office_time_limits?: Json
          owner_resign_after_install?: boolean
          partner_lead_fee_inc_gst?: number
          payment_option_gate_enabled?: boolean
          photo_max_distance_m?: number
          piesa_install_window_days?: number
          quote_estimate_variance_tolerance_pct?: number
          ready_check_booking_enabled?: boolean
          rec_offer_batch_size?: number
          rec_offer_business_hours?: number
          rec_offer_expiry_hours?: number
          safety_check_payment_inc_gst?: number
          save_my_spot_auto_rules?: Json
          save_my_spot_real_send_enabled?: boolean
          sms_message_switches?: Json
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
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_enquiry_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "office_job_list"
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
          eligibility_flags: Json | null
          eligibility_outcome:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_review_required: boolean | null
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
      office_enquiry_index: {
        Row: {
          channel: string | null
          contact_rank: number | null
          correspondence_recorded: boolean | null
          created_at: string | null
          deleted_at: string | null
          eligibility_outcome: string | null
          eligibility_set_at: string | null
          email_key: string | null
          enquiry_status: string | null
          external_enquiry_id: string | null
          first_response_sent: boolean | null
          id: string | null
          job_number: string | null
          latest_attempt_at: string | null
          latest_attempt_status: string | null
          latest_media_at: string | null
          media_count: number | null
          media_to_review: boolean | null
          more_photos_requested: boolean | null
          more_photos_requested_at: string | null
          needs_first_response: boolean | null
          office_bucket: string | null
          owner_email: string | null
          owner_name: string | null
          owner_phone: string | null
          owner_progressed: boolean | null
          photos_requested: boolean | null
          property_address: string | null
          property_key: string | null
          qa_archived_at: string | null
          removed: boolean | null
          response_state: string | null
          response_uncertain: boolean | null
          review_at: string | null
          review_outcome: string | null
          source: string | null
          spot_offered: boolean | null
          spot_saved: boolean | null
          stage: string | null
        }
        Relationships: []
      }
      office_job_list: {
        Row: {
          authority_expires_at: string | null
          authority_status: string | null
          channel: Database["public"]["Enums"]["job_channel"] | null
          commercial_model:
            | Database["public"]["Enums"]["commercial_model"]
            | null
          contact_rank: number | null
          created_at: string | null
          days_remaining: number | null
          deposit_cleared: boolean | null
          electrician_id: string | null
          electrician_name: string | null
          eligibility_flags: Json | null
          eligibility_outcome:
            | Database["public"]["Enums"]["eligibility_outcome"]
            | null
          eligibility_review_required: boolean | null
          hold_reason: string | null
          id: string | null
          install_deadline: string | null
          installer_id: string | null
          installer_name: string | null
          job_number: string | null
          last_activity_at: string | null
          life_support: boolean | null
          next_action: string | null
          office_bucket: string | null
          office_removed: boolean | null
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
    }
    Functions: {
      _bulk_import_access: {
        Args: { _actor: string; _business: string; _work?: boolean }
        Returns: undefined
      }
      _bulk_import_claimed: {
        Args: { _actor: string; _row: string; _token: string }
        Returns: {
          batch_id: string
          confirm_claim_token: string | null
          confirm_error: string | null
          confirm_lease_until: string | null
          confirm_snapshot: Json | null
          created_at: string
          duplicate_note: string | null
          electrician_plan: Json | null
          extracted: Json
          id: string
          import_stage: string
          job_id: string | null
          match_confidence: string | null
          matched_files: Json
          missing_evidence: Json
          office_review_reason: string | null
          row_index: number
          sort_reasons: Json
          sort_result: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "bulk_import_rows"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _bulk_import_document: {
        Args: { _actor: string; _business: string; _file: Json; _job: string }
        Returns: string
      }
      _bulk_import_quote_complete: {
        Args: { _job: string; _quote: string }
        Returns: boolean
      }
      accept_install_day: {
        Args: {
          _assignment: string
          _deadline: string
          _proposal: string
          _user: string
        }
        Returns: string
      }
      accept_partner_offer: {
        Args: { _offer: string; _user: string }
        Returns: {
          assignment_id: string
          outcome: string
        }[]
      }
      accept_partner_offer_slot: {
        Args: { _offer: string; _proposal: string; _user: string }
        Returns: {
          assignment_id: string
          outcome: string
        }[]
      }
      accept_pre_assessment_test: {
        Args: {
          _accepted_ip?: unknown
          _accepted_user_agent?: string
          _copy_version: string
          _customer_total: number
          _estimate_id: string
          _estimate_input_signature: string
          _estimate_settings_version: number
          _estimated_discount: number
          _estimated_remaining: number
          _job_id: string
          _snapshot: Json
        }
        Returns: {
          acceptance_id: string
          accepted_at: string
          created: boolean
          paid_at: string
          payment_id: string
          payment_status: string
        }[]
      }
      accept_ready_check_offer: {
        Args: { _offer: string; _user: string; _window: string }
        Returns: {
          assignment_id: string
          outcome: string
        }[]
      }
      accept_ready_check_test: {
        Args: {
          _accepted_ip?: unknown
          _accepted_user_agent?: string
          _copy_version: string
          _cost_after_discount: number
          _estimate_id: string
          _estimate_input_signature: string
          _estimate_settings_version: number
          _estimated_discount: number
          _estimated_remaining: number
          _job_id: string
          _snapshot: Json
        }
        Returns: {
          acceptance_id: string
          accepted_at: string
          created: boolean
          paid_at: string
          payment_id: string
          payment_status: string
        }[]
      }
      activate_electrician_rate: {
        Args: { _actor: string; _rate_id: string }
        Returns: string
      }
      activate_partner_application: {
        Args: {
          _actor: string
          _app_id: string
          _override: string
          _plan: Json
        }
        Returns: {
          business_id: string
          outcome: string
          rate_card_id: string
        }[]
      }
      apply_pre_assessment_test_payment: {
        Args: {
          _idempotency_key: string
          _outcome: string
          _payment_id: string
        }
        Returns: {
          changed: boolean
          paid_at: string
          payment_status: string
        }[]
      }
      apply_ready_check_test_payment: {
        Args: {
          _idempotency_key: string
          _outcome: string
          _payment_id: string
        }
        Returns: {
          changed: boolean
          paid_at: string
          payment_status: string
        }[]
      }
      approve_rectification_with_window: {
        Args: { _proposal: string; _quote: string; _user: string }
        Returns: string
      }
      begin_outlook_message: {
        Args: {
          _mailbox: string
          _message: Json
          _record_only?: boolean
          _route: Json
        }
        Returns: Json
      }
      begin_quarantine_validation: {
        Args: { _app: string; _path: string }
        Returns: boolean
      }
      bulk_import_batch_counts: {
        Args: { _actor: string; _batches: string[] }
        Returns: Json
      }
      bump_referral_counter: {
        Args: { _field: string; _id: string }
        Returns: undefined
      }
      calculator_interest_is_duplicate: {
        Args: { _email: string; _mobile: string }
        Returns: boolean
      }
      can_access_job: { Args: { _job: string }; Returns: boolean }
      claim_bulk_import_row: {
        Args: { _actor: string; _row: string; _token: string }
        Returns: Json
      }
      claim_customer_followups: {
        Args: { _lease_seconds: number; _limit: number }
        Returns: {
          attempts: number
          blocked_reason: string | null
          communication_id: string | null
          created_at: string
          due_at: string
          estimate_link_id: string | null
          id: string
          job_id: string
          kind: string
          last_error: string | null
          lease_until: string | null
          reason: string | null
          sent_at: string | null
          slot: string
          status: string
          suppression_reason: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "customer_followups"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_first_response_retries: {
        Args: { p_activated_at: string; p_limit?: number }
        Returns: {
          business_unit: string
          channel: string
          claim_token: string
          created_at: string
          job_id: string
          job_number: string
          needs_first_response: boolean
          office_bucket: string
          source: string
        }[]
      }
      claim_partner_login_link: {
        Args: { _token_hash: string }
        Returns: {
          email: string
          outcome: string
        }[]
      }
      claim_post_intake_work: {
        Args: { _job?: string; _lease_seconds: number; _limit: number }
        Returns: {
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          facts_version: string
          id: string
          job_id: string
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          reason: string | null
          status: string
          updated_at: string
          work_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "post_intake_work"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_quarantine_cleanup: {
        Args: { _app?: string; _limit: number }
        Returns: {
          application_id: string
          path: string
        }[]
      }
      clear_onboarding_start_block: {
        Args: {
          _actor: string
          _fp: string
          _kind: string
          _reason: string
          _trade: string
        }
        Returns: number
      }
      close_bulk_import_batch: {
        Args: { _actor: string; _batch: string }
        Returns: Json
      }
      commit_guarded_stage: {
        Args: {
          _actor: string
          _details: Json
          _disposition?: string
          _expected: Database["public"]["Enums"]["job_stage"]
          _job: string
          _next: string
          _summary: string
          _to: Database["public"]["Enums"]["job_stage"]
        }
        Returns: boolean
      }
      confirm_outlook_mailbox: {
        Args: { _actor: string; _mailbox: string }
        Returns: undefined
      }
      consume_cron_nonce: {
        Args: { _nonce: string; _purpose: string }
        Returns: boolean
      }
      consume_onboarding_authorisation: {
        Args: { _hash: string; _trade: string }
        Returns: {
          allow_incomplete_sign: boolean
          id: string
          purpose: string
        }[]
      }
      consume_onboarding_start: {
        Args: { _fp: string; _kind: string; _trade: string }
        Returns: boolean
      }
      consume_worker_access_budget: {
        Args: { _key: string; _limit: number }
        Returns: boolean
      }
      consume_worker_invite: {
        Args: {
          _agent: string
          _declarations: Json
          _hash: string
          _ip: string
          _submission: Json
        }
        Returns: boolean
      }
      customer_followups_tick: { Args: { _url: string }; Returns: number }
      discard_electrician_rate: {
        Args: { _actor: string; _rate_id: string; _reason: string }
        Returns: undefined
      }
      edit_bulk_import_row: {
        Args: { _actor: string; _expected: Json; _patch: Json; _row: string }
        Returns: Json
      }
      enqueue_external_action: {
        Args: {
          _action: string
          _basis: string
          _event: string
          _facts: string
          _job: string
          _key: string
          _payload: string
          _target: string
          _version: string
        }
        Returns: string
      }
      finish_bulk_import_row: {
        Args: {
          _actor: string
          _audit: Json
          _files: Json
          _owner_link: Json
          _quote: Json
          _row: string
          _token: string
        }
        Returns: Json
      }
      finish_first_response_retry: {
        Args: {
          p_claim_token: string
          p_job_id: string
          p_outcome: string
          p_reason: string
          p_route: string
        }
        Returns: boolean
      }
      finish_outlook_message: {
        Args: { _decision: Json; _message_id: string }
        Returns: Json
      }
      finish_quarantine_cleanup: {
        Args: {
          _actor?: string
          _bytes: number[]
          _paths: string[]
          _trigger: string
        }
        Returns: {
          bytes: number
          files: number
          run_id: number
        }[]
      }
      finish_quarantine_validation: {
        Args: {
          _accepted: boolean
          _app: string
          _bytes: number
          _path: string
        }
        Returns: boolean
      }
      first_response_retry_scope: {
        Args: { p_activated_at: string; p_now: string }
        Returns: {
          business_unit: string
          channel: string
          created_at: string
          job_id: string
          job_number: string
          needs_first_response: boolean
          office_bucket: string
          source: string
        }[]
      }
      format_property_address: {
        Args: {
          _address_line: string
          _postcode: string
          _state: string
          _suburb: string
        }
        Returns: string
      }
      get_my_profile: {
        Args: never
        Returns: {
          business_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          licence_number: string | null
          mitti_checked_at: string | null
          mitti_checked_email: string | null
          mitti_user_id: string | null
          phone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_contact_release: {
        Args: { _job: string; _user: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      instalment_plan_active: { Args: { _inv: string }; Returns: boolean }
      invoice_deposit_cleared: { Args: { _inv: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_business_member: {
        Args: { _admin_only?: boolean; _biz: string }
        Returns: boolean
      }
      is_job_owner: { Args: { _job: string; _user: string }; Returns: boolean }
      issue_owner_link_code: {
        Args: {
          _channel: string
          _expires: string
          _hash: string
          _job: string
          _masked: string
          _max: number
        }
        Returns: string
      }
      job_assignment_role: {
        Args: { _job: string; _user: string }
        Returns: Database["public"]["Enums"]["assignment_role"]
      }
      job_authority_expires_at: { Args: { _job: string }; Returns: string }
      job_authority_status: { Args: { _job: string }; Returns: string }
      job_deposit_cleared: { Args: { _job: string }; Returns: boolean }
      link_confirmed_owner_account: {
        Args: { _email: string; _user_id: string }
        Returns: boolean
      }
      list_onboarding_start_blocks: {
        Args: never
        Returns: {
          blocked: boolean
          fingerprint_hash: string
          kind: string
          last_attempt: string
          recent_15m: number
          recent_24h: number
          refused: number
          trade: string
        }[]
      }
      my_job_role: { Args: { _job: string }; Returns: string }
      offer_owner_ready_check_booking: {
        Args: { _job: string }
        Returns: undefined
      }
      office_enquiry_page: {
        Args: { p_page?: number; p_search?: string; p_view?: string }
        Returns: Json
      }
      owner_quote_released: {
        Args: {
          _release_state: string
          _sent_at: string
          _status: Database["public"]["Enums"]["quote_status"]
        }
        Returns: boolean
      }
      owner_ready_check_booking_allowed: {
        Args: { _job: string }
        Returns: boolean
      }
      place_install_hold: {
        Args: {
          _area: number
          _business: string
          _job: string
          _over?: boolean
          _reason: string
          _week: string
        }
        Returns: string
      }
      post_intake_tick: { Args: { _url: string }; Returns: number }
      prepare_bulk_import_job: {
        Args: { _actor: string; _job_input: Json; _row: string; _token: string }
        Returns: Json
      }
      publish_owner_prices: {
        Args: { _actor: string; _prices: Json; _reason: string }
        Returns: number
      }
      quote_visible_to_current_user: {
        Args: {
          _job_id: string
          _kind: Database["public"]["Enums"]["quote_kind"]
          _release_state: string
          _sent_at: string
          _status: Database["public"]["Enums"]["quote_status"]
        }
        Returns: boolean
      }
      record_eligibility_verification: {
        Args: {
          _evidence_complete: boolean
          _flags: Json
          _job: string
          _note: string
          _outcome: string
          _reason: string
          _ref: string
          _reviews: Json
          _ruleset: string
          _snapshot: Json
          _version: number
        }
        Returns: string
      }
      record_expired_onboarding_authorisations: { Args: never; Returns: number }
      record_worker_certification: {
        Args: {
          _actor: string
          _app_id: string
          _email: string
          _issuer: string
          _note: string
          _number: string
          _source: string
          _status: string
        }
        Returns: string
      }
      release_bulk_import_row: {
        Args: {
          _actor: string
          _error: string
          _row: string
          _skip?: boolean
          _token: string
        }
        Returns: undefined
      }
      renew_bulk_import_row: {
        Args: { _actor: string; _row: string; _token: string }
        Returns: undefined
      }
      repair_bulk_import_attachment: {
        Args: { _actor: string; _file: Json; _row: string }
        Returns: string
      }
      required_deposit_amount: { Args: { _total: number }; Returns: number }
      review_external_action: {
        Args: {
          _actor: string
          _id: string
          _operation: string
          _reason: string
        }
        Returns: undefined
      }
      revoke_onboarding_authorisation: {
        Args: { _actor: string; _id: string }
        Returns: boolean
      }
      save_bulk_import_analysis: {
        Args: { _actor: string; _batch: string; _rows: Json; _summary: Json }
        Returns: undefined
      }
      save_owner_insulation_details: {
        Args: { p_answers: Json; p_token: string }
        Returns: Json
      }
      set_bulk_import_plan: {
        Args: { _actor: string; _batch: string; _plan: Json }
        Returns: undefined
      }
      set_external_action_mode: {
        Args: {
          _action: string
          _actor: string
          _mode: string
          _reason: string
        }
        Returns: undefined
      }
      set_ready_check_booking_enabled: {
        Args: { _enabled: boolean }
        Returns: undefined
      }
      shares_job_with: { Args: { _profile: string }; Returns: boolean }
      sign_installer_application: {
        Args: {
          _agreement_sha256: string
          _app_id: string
          _enquiry: Json
          _expected_updated_at: string
          _nominations: Json
          _signed: Json
        }
        Returns: {
          outcome: string
          partner_enquiry_id: string
          signed_at: string
        }[]
      }
      sign_rec_application: {
        Args: {
          _agreement_sha256: string
          _app_id: string
          _enquiry: Json
          _expected_updated_at: string
          _signed: Json
        }
        Returns: {
          outcome: string
          partner_enquiry_id: string
          signed_at: string
        }[]
      }
      start_first_response_retry: {
        Args: {
          p_activated_at: string
          p_claim_token: string
          p_job_id: string
        }
        Returns: boolean
      }
      trade_quote_scope: {
        Args: { _job: string }
        Returns: {
          description: string
          quantity: number
          quote_kind: Database["public"]["Enums"]["quote_kind"]
          quote_status: Database["public"]["Enums"]["quote_status"]
          sort: number
        }[]
      }
      visit_is_current: {
        Args: {
          _stage: Database["public"]["Enums"]["job_stage"]
          _visit: string
        }
        Returns: boolean
      }
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
      booking_kind:
        | "assessment"
        | "rectification"
        | "installation"
        | "ready_check"
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
        | "identity_front_of_property"
        | "switchboard_cables"
        | "electrical_isolation"
        | "solar_battery"
        | "post_install_video"
        | "final_zone_plan"
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
        | "preliminary_estimate_ready"
        | "ready_check_awaiting_acceptance"
        | "ready_check_awaiting_payment"
        | "ready_check_ready_to_schedule"
        | "ready_check_scheduled"
        | "ready_check_complete"
        | "measured_estimate_ready"
        | "measured_quote_accepted"
        | "piesa_and_install_window_pending"
        | "piesa_scheduled"
        | "piesa_complete"
        | "electrical_variation_pending"
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
      quote_status:
        | "draft"
        | "issued"
        | "accepted"
        | "declined"
        | "superseded"
        | "expired"
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
      booking_kind: [
        "assessment",
        "rectification",
        "installation",
        "ready_check",
      ],
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
        "identity_front_of_property",
        "switchboard_cables",
        "electrical_isolation",
        "solar_battery",
        "post_install_video",
        "final_zone_plan",
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
        "preliminary_estimate_ready",
        "ready_check_awaiting_acceptance",
        "ready_check_awaiting_payment",
        "ready_check_ready_to_schedule",
        "ready_check_scheduled",
        "ready_check_complete",
        "measured_estimate_ready",
        "measured_quote_accepted",
        "piesa_and_install_window_pending",
        "piesa_scheduled",
        "piesa_complete",
        "electrical_variation_pending",
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
      quote_status: [
        "draft",
        "issued",
        "accepted",
        "declined",
        "superseded",
        "expired",
      ],
      rate_card_kind: ["installer", "electrical"],
      sync_status: ["not_synced", "pending", "synced", "error"],
    },
  },
} as const

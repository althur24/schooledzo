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
      academic_years: {
        Row: {
          created_at: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          name: string
          school_id: string
          start_date: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          school_id: string
          start_date?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          school_id?: string
          start_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academic_years_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_reviews: {
        Row: {
          created_at: string | null
          decision: string
          id: string
          notes: string | null
          override_bloom: number | null
          override_boundedness: string | null
          override_difficulty: string | null
          override_hots_strength: string | null
          question_id: string
          question_source: string
          return_reasons: string[] | null
          reviewer_id: string | null
        }
        Insert: {
          created_at?: string | null
          decision: string
          id?: string
          notes?: string | null
          override_bloom?: number | null
          override_boundedness?: string | null
          override_difficulty?: string | null
          override_hots_strength?: string | null
          question_id: string
          question_source: string
          return_reasons?: string[] | null
          reviewer_id?: string | null
        }
        Update: {
          created_at?: string | null
          decision?: string
          id?: string
          notes?: string | null
          override_bloom?: number | null
          override_boundedness?: string | null
          override_difficulty?: string | null
          override_hots_strength?: string | null
          question_id?: string
          question_source?: string
          return_reasons?: string[] | null
          reviewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reviews: {
        Row: {
          ambiguity_flags: string[] | null
          bloom_confidence: number | null
          boundedness: string | null
          boundedness_confidence: number | null
          clarity_score: number | null
          created_at: string | null
          difficulty_confidence: number | null
          difficulty_label: string | null
          difficulty_reasons: string[] | null
          difficulty_score: number | null
          full_json_report: Json | null
          grade_fit_flags: string[] | null
          hots_confidence: number | null
          hots_flag: boolean | null
          hots_signals: string[] | null
          hots_strength: string | null
          id: string
          missing_info_flags: string[] | null
          model_version: string | null
          primary_bloom_level: number | null
          question_id: string
          question_source: string
          secondary_bloom_levels: number[] | null
          subject_match_score: number | null
          suggested_edits: Json | null
        }
        Insert: {
          ambiguity_flags?: string[] | null
          bloom_confidence?: number | null
          boundedness?: string | null
          boundedness_confidence?: number | null
          clarity_score?: number | null
          created_at?: string | null
          difficulty_confidence?: number | null
          difficulty_label?: string | null
          difficulty_reasons?: string[] | null
          difficulty_score?: number | null
          full_json_report?: Json | null
          grade_fit_flags?: string[] | null
          hots_confidence?: number | null
          hots_flag?: boolean | null
          hots_signals?: string[] | null
          hots_strength?: string | null
          id?: string
          missing_info_flags?: string[] | null
          model_version?: string | null
          primary_bloom_level?: number | null
          question_id: string
          question_source: string
          secondary_bloom_levels?: number[] | null
          subject_match_score?: number | null
          suggested_edits?: Json | null
        }
        Update: {
          ambiguity_flags?: string[] | null
          bloom_confidence?: number | null
          boundedness?: string | null
          boundedness_confidence?: number | null
          clarity_score?: number | null
          created_at?: string | null
          difficulty_confidence?: number | null
          difficulty_label?: string | null
          difficulty_reasons?: string[] | null
          difficulty_score?: number | null
          full_json_report?: Json | null
          grade_fit_flags?: string[] | null
          hots_confidence?: number | null
          hots_flag?: boolean | null
          hots_signals?: string[] | null
          hots_strength?: string | null
          id?: string
          missing_info_flags?: string[] | null
          model_version?: string | null
          primary_bloom_level?: number | null
          question_id?: string
          question_source?: string
          secondary_bloom_levels?: number[] | null
          subject_match_score?: number | null
          suggested_edits?: Json | null
        }
        Relationships: []
      }
      announcements: {
        Row: {
          class_ids: string[] | null
          content: string
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          is_global: boolean | null
          published_at: string | null
          school_id: string | null
          title: string
        }
        Insert: {
          class_ids?: string[] | null
          content: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          is_global?: boolean | null
          published_at?: string | null
          school_id?: string | null
          title: string
        }
        Update: {
          class_ids?: string[] | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          is_global?: boolean | null
          published_at?: string | null
          school_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          created_at: string | null
          description: string | null
          due_date: string | null
          id: string
          submission_mode: string
          teaching_assignment_id: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          submission_mode?: string
          teaching_assignment_id?: string | null
          title: string
          type: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          submission_mode?: string
          teaching_assignment_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_teaching_assignment_id_fkey"
            columns: ["teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year_id: string | null
          created_at: string | null
          grade_level: number | null
          homeroom_teacher_id: string | null
          id: string
          name: string
          school_level: string | null
        }
        Insert: {
          academic_year_id?: string | null
          created_at?: string | null
          grade_level?: number | null
          homeroom_teacher_id?: string | null
          id?: string
          name: string
          school_level?: string | null
        }
        Update: {
          academic_year_id?: string | null
          created_at?: string | null
          grade_level?: number | null
          homeroom_teacher_id?: string | null
          id?: string
          name?: string
          school_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_homeroom_teacher_id_fkey"
            columns: ["homeroom_teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_runs: {
        Row: {
          job: string
          last_run_at: string
        }
        Insert: {
          job: string
          last_run_at?: string
        }
        Update: {
          job?: string
          last_run_at?: string
        }
        Relationships: []
      }
      exam_answers: {
        Row: {
          answer: string | null
          created_at: string | null
          id: string
          is_correct: boolean | null
          points_earned: number | null
          question_id: string
          submission_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          points_earned?: number | null
          question_id: string
          submission_id: string
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          points_earned?: number | null
          question_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_answers_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "exam_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          content_format: string
          correct_answer: string | null
          created_at: string | null
          difficulty: string | null
          exam_id: string
          id: string
          image_url: string | null
          options: Json | null
          order_index: number | null
          passage_audio_url: string | null
          passage_text: string | null
          points: number | null
          question_text: string
          question_type: string | null
          status: string | null
          tags: string[] | null
          teacher_hots_claim: boolean | null
          text_direction: string
        }
        Insert: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          exam_id: string
          id?: string
          image_url?: string | null
          options?: Json | null
          order_index?: number | null
          passage_audio_url?: string | null
          passage_text?: string | null
          points?: number | null
          question_text: string
          question_type?: string | null
          status?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          text_direction?: string
        }
        Update: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          exam_id?: string
          id?: string
          image_url?: string | null
          options?: Json | null
          order_index?: number | null
          passage_audio_url?: string | null
          passage_text?: string | null
          points?: number | null
          question_text?: string
          question_type?: string | null
          status?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          text_direction?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_submissions: {
        Row: {
          created_at: string | null
          exam_id: string
          id: string
          is_graded: boolean | null
          is_submitted: boolean | null
          max_score: number | null
          question_order: Json | null
          started_at: string | null
          student_id: string
          submitted_at: string | null
          timer_override_until: string | null
          total_score: number | null
          violation_count: number | null
          violations_log: Json | null
        }
        Insert: {
          created_at?: string | null
          exam_id: string
          id?: string
          is_graded?: boolean | null
          is_submitted?: boolean | null
          max_score?: number | null
          question_order?: Json | null
          started_at?: string | null
          student_id: string
          submitted_at?: string | null
          timer_override_until?: string | null
          total_score?: number | null
          violation_count?: number | null
          violations_log?: Json | null
        }
        Update: {
          created_at?: string | null
          exam_id?: string
          id?: string
          is_graded?: boolean | null
          is_submitted?: boolean | null
          max_score?: number | null
          question_order?: Json | null
          started_at?: string | null
          student_id?: string
          submitted_at?: string | null
          timer_override_until?: string | null
          total_score?: number | null
          violation_count?: number | null
          violations_log?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_submissions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          allowed_student_ids: string[] | null
          batch_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean | null
          is_randomized: boolean | null
          is_remedial: boolean | null
          max_violations: number | null
          pending_publish: boolean | null
          remedial_for_id: string | null
          results_released: boolean | null
          show_results_immediately: boolean | null
          start_time: string
          teaching_assignment_id: string
          title: string
          updated_at: string | null
          window_end_time: string | null
        }
        Insert: {
          allowed_student_ids?: string[] | null
          batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          is_randomized?: boolean | null
          is_remedial?: boolean | null
          max_violations?: number | null
          pending_publish?: boolean | null
          remedial_for_id?: string | null
          results_released?: boolean | null
          show_results_immediately?: boolean | null
          start_time: string
          teaching_assignment_id: string
          title: string
          updated_at?: string | null
          window_end_time?: string | null
        }
        Update: {
          allowed_student_ids?: string[] | null
          batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          is_randomized?: boolean | null
          is_remedial?: boolean | null
          max_violations?: number | null
          pending_publish?: boolean | null
          remedial_for_id?: string | null
          results_released?: boolean | null
          show_results_immediately?: boolean | null
          start_time?: string
          teaching_assignment_id?: string
          title?: string
          updated_at?: string | null
          window_end_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_remedial_for_id_fkey"
            columns: ["remedial_for_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_teaching_assignment_id_fkey"
            columns: ["teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          max_score: number | null
          new_score: number
          old_score: number | null
          ref_id: string
          ref_title: string | null
          school_id: string | null
          source: string
          student_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          max_score?: number | null
          new_score: number
          old_score?: number | null
          ref_id: string
          ref_title?: string | null
          school_id?: string | null
          source: string
          student_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          max_score?: number | null
          new_score?: number
          old_score?: number | null
          ref_id?: string
          ref_title?: string | null
          school_id?: string | null
          source?: string
          student_id?: string
        }
        Relationships: []
      }
      grades: {
        Row: {
          feedback: string | null
          graded_at: string | null
          id: string
          score: number | null
          submission_id: string | null
        }
        Insert: {
          feedback?: string | null
          graded_at?: string | null
          id?: string
          score?: number | null
          submission_id?: string | null
        }
        Update: {
          feedback?: string | null
          graded_at?: string | null
          id?: string
          score?: number | null
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grades_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "student_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          content_text: string | null
          content_url: string | null
          created_at: string | null
          description: string | null
          id: string
          teaching_assignment_id: string | null
          title: string
          type: string
        }
        Insert: {
          content_text?: string | null
          content_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          teaching_assignment_id?: string | null
          title: string
          type: string
        }
        Update: {
          content_text?: string | null
          content_url?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          teaching_assignment_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_teaching_assignment_id_fkey"
            columns: ["teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      official_exam_answers: {
        Row: {
          answer: string | null
          created_at: string | null
          id: string
          is_correct: boolean | null
          points_earned: number | null
          question_id: string
          submission_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          points_earned?: number | null
          question_id: string
          submission_id: string
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          points_earned?: number | null
          question_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "official_exam_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "official_exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_exam_answers_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "official_exam_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      official_exam_questions: {
        Row: {
          content_format: string
          correct_answer: string | null
          created_at: string | null
          difficulty: string | null
          exam_id: string
          id: string
          image_url: string | null
          options: Json | null
          order_index: number | null
          passage_audio_url: string | null
          passage_text: string | null
          points: number | null
          question_text: string
          question_type: string
          status: string | null
          tags: string[] | null
          teacher_hots_claim: boolean | null
          text_direction: string
        }
        Insert: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          exam_id: string
          id?: string
          image_url?: string | null
          options?: Json | null
          order_index?: number | null
          passage_audio_url?: string | null
          passage_text?: string | null
          points?: number | null
          question_text: string
          question_type: string
          status?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          text_direction?: string
        }
        Update: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          exam_id?: string
          id?: string
          image_url?: string | null
          options?: Json | null
          order_index?: number | null
          passage_audio_url?: string | null
          passage_text?: string | null
          points?: number | null
          question_text?: string
          question_type?: string
          status?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          text_direction?: string
        }
        Relationships: [
          {
            foreignKeyName: "official_exam_questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "official_exams"
            referencedColumns: ["id"]
          },
        ]
      }
      official_exam_submissions: {
        Row: {
          created_at: string | null
          exam_id: string
          id: string
          is_graded: boolean | null
          is_submitted: boolean | null
          max_score: number | null
          question_order: Json | null
          started_at: string | null
          student_id: string
          submitted_at: string | null
          timer_override_until: string | null
          total_score: number | null
          violation_count: number | null
          violations_log: Json | null
        }
        Insert: {
          created_at?: string | null
          exam_id: string
          id?: string
          is_graded?: boolean | null
          is_submitted?: boolean | null
          max_score?: number | null
          question_order?: Json | null
          started_at?: string | null
          student_id: string
          submitted_at?: string | null
          timer_override_until?: string | null
          total_score?: number | null
          violation_count?: number | null
          violations_log?: Json | null
        }
        Update: {
          created_at?: string | null
          exam_id?: string
          id?: string
          is_graded?: boolean | null
          is_submitted?: boolean | null
          max_score?: number | null
          question_order?: Json | null
          started_at?: string | null
          student_id?: string
          submitted_at?: string | null
          timer_override_until?: string | null
          total_score?: number | null
          violation_count?: number | null
          violations_log?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "official_exam_submissions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "official_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_exam_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      official_exams: {
        Row: {
          academic_year_id: string
          allowed_student_ids: string[] | null
          created_at: string | null
          created_by: string | null
          description: string | null
          duration_minutes: number
          exam_type: string
          id: string
          is_active: boolean | null
          is_randomized: boolean | null
          is_remedial: boolean | null
          max_violations: number | null
          remedial_for_id: string | null
          results_released: boolean | null
          school_id: string
          show_results_immediately: boolean | null
          start_time: string
          subject_id: string
          target_class_ids: string[]
          title: string
          updated_at: string | null
          window_end_time: string | null
        }
        Insert: {
          academic_year_id: string
          allowed_student_ids?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          exam_type: string
          id?: string
          is_active?: boolean | null
          is_randomized?: boolean | null
          is_remedial?: boolean | null
          max_violations?: number | null
          remedial_for_id?: string | null
          results_released?: boolean | null
          school_id: string
          show_results_immediately?: boolean | null
          start_time: string
          subject_id: string
          target_class_ids?: string[]
          title: string
          updated_at?: string | null
          window_end_time?: string | null
        }
        Update: {
          academic_year_id?: string
          allowed_student_ids?: string[] | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          exam_type?: string
          id?: string
          is_active?: boolean | null
          is_randomized?: boolean | null
          is_remedial?: boolean | null
          max_violations?: number | null
          remedial_for_id?: string | null
          results_released?: boolean | null
          school_id?: string
          show_results_immediately?: boolean | null
          start_time?: string
          subject_id?: string
          target_class_ids?: string[]
          title?: string
          updated_at?: string | null
          window_end_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "official_exams_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_exams_remedial_for_id_fkey"
            columns: ["remedial_for_id"]
            isOneToOne: false
            referencedRelation: "official_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_exams_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_exams_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      question_bank: {
        Row: {
          content_format: string
          correct_answer: string | null
          created_at: string | null
          difficulty: string | null
          id: string
          image_url: string | null
          options: Json | null
          order_in_passage: number | null
          passage_id: string | null
          question_text: string
          question_type: string
          source_exam_id: string | null
          source_name: string | null
          source_quiz_id: string | null
          source_type: string | null
          status: string | null
          subject_id: string | null
          tags: string[] | null
          teacher_hots_claim: boolean | null
          teacher_id: string | null
        }
        Insert: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          id?: string
          image_url?: string | null
          options?: Json | null
          order_in_passage?: number | null
          passage_id?: string | null
          question_text: string
          question_type: string
          source_exam_id?: string | null
          source_name?: string | null
          source_quiz_id?: string | null
          source_type?: string | null
          status?: string | null
          subject_id?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          teacher_id?: string | null
        }
        Update: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          id?: string
          image_url?: string | null
          options?: Json | null
          order_in_passage?: number | null
          passage_id?: string | null
          question_text?: string
          question_type?: string
          source_exam_id?: string | null
          source_name?: string | null
          source_quiz_id?: string | null
          source_type?: string | null
          status?: string | null
          subject_id?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "question_bank_passage_id_fkey"
            columns: ["passage_id"]
            isOneToOne: false
            referencedRelation: "question_passages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_source_exam_id_fkey"
            columns: ["source_exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_source_quiz_id_fkey"
            columns: ["source_quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      question_passages: {
        Row: {
          audio_url: string | null
          created_at: string | null
          id: string
          passage_text: string
          school_id: string | null
          subject_id: string | null
          teacher_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          audio_url?: string | null
          created_at?: string | null
          id?: string
          passage_text: string
          school_id?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          audio_url?: string | null
          created_at?: string | null
          id?: string
          passage_text?: string
          school_id?: string | null
          subject_id?: string | null
          teacher_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "question_passages_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_passages_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_passages_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          assignment_id: string | null
          correct_answer: string | null
          created_at: string | null
          id: string
          options: Json | null
          points: number | null
          question: string
          type: string
        }
        Insert: {
          assignment_id?: string | null
          correct_answer?: string | null
          created_at?: string | null
          id?: string
          options?: Json | null
          points?: number | null
          question: string
          type: string
        }
        Update: {
          assignment_id?: string | null
          correct_answer?: string | null
          created_at?: string | null
          id?: string
          options?: Json | null
          points?: number | null
          question?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          content_format: string
          correct_answer: string | null
          created_at: string | null
          difficulty: string | null
          id: string
          image_url: string | null
          options: Json | null
          order_index: number | null
          passage_audio_url: string | null
          passage_text: string | null
          points: number | null
          question_text: string
          question_type: string
          quiz_id: string | null
          status: string | null
          tags: string[] | null
          teacher_hots_claim: boolean | null
          text_direction: string
        }
        Insert: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          id?: string
          image_url?: string | null
          options?: Json | null
          order_index?: number | null
          passage_audio_url?: string | null
          passage_text?: string | null
          points?: number | null
          question_text: string
          question_type: string
          quiz_id?: string | null
          status?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          text_direction?: string
        }
        Update: {
          content_format?: string
          correct_answer?: string | null
          created_at?: string | null
          difficulty?: string | null
          id?: string
          image_url?: string | null
          options?: Json | null
          order_index?: number | null
          passage_audio_url?: string | null
          passage_text?: string | null
          points?: number | null
          question_text?: string
          question_type?: string
          quiz_id?: string | null
          status?: string | null
          tags?: string[] | null
          teacher_hots_claim?: boolean | null
          text_direction?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_submissions: {
        Row: {
          answers: Json | null
          id: string
          is_graded: boolean | null
          max_score: number | null
          needs_manual_review: boolean
          quiz_id: string | null
          started_at: string | null
          student_id: string | null
          submitted_at: string | null
          total_score: number | null
        }
        Insert: {
          answers?: Json | null
          id?: string
          is_graded?: boolean | null
          max_score?: number | null
          needs_manual_review?: boolean
          quiz_id?: string | null
          started_at?: string | null
          student_id?: string | null
          submitted_at?: string | null
          total_score?: number | null
        }
        Update: {
          answers?: Json | null
          id?: string
          is_graded?: boolean | null
          max_score?: number | null
          needs_manual_review?: boolean
          quiz_id?: string | null
          started_at?: string | null
          student_id?: string | null
          submitted_at?: string | null
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_submissions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          allowed_student_ids: string[] | null
          available_from: string | null
          batch_id: string | null
          created_at: string | null
          deadline: string | null
          description: string | null
          duration_minutes: number | null
          id: string
          is_active: boolean | null
          is_randomized: boolean | null
          is_remedial: boolean | null
          pending_publish: boolean | null
          remedial_for_id: string | null
          submission_mode: string
          teaching_assignment_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          allowed_student_ids?: string[] | null
          available_from?: string | null
          batch_id?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_randomized?: boolean | null
          is_remedial?: boolean | null
          pending_publish?: boolean | null
          remedial_for_id?: string | null
          submission_mode?: string
          teaching_assignment_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          allowed_student_ids?: string[] | null
          available_from?: string | null
          batch_id?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_randomized?: boolean | null
          is_remedial?: boolean | null
          pending_publish?: boolean | null
          remedial_for_id?: string | null
          submission_mode?: string
          teaching_assignment_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_remedial_for_id_fkey"
            columns: ["remedial_for_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_teaching_assignment_id_fkey"
            columns: ["teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_entries: {
        Row: {
          created_at: string | null
          day_of_week: number
          id: string
          period: number
          room: string | null
          schedule_id: string
          subject_id: string | null
          teacher_id: string | null
          time_end: string
          time_start: string
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          id?: string
          period: number
          room?: string | null
          schedule_id: string
          subject_id?: string | null
          teacher_id?: string | null
          time_end: string
          time_start: string
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          id?: string
          period?: number
          room?: string | null
          schedule_id?: string
          subject_id?: string | null
          teacher_id?: string | null
          time_end?: string
          time_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_entries_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_entries_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_entries_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string | null
          created_by: string | null
          effective_from: string
          id: string
          is_active: boolean | null
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string | null
          created_by?: string | null
          effective_from?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string | null
          created_by?: string | null
          effective_from?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedules_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          address: string | null
          code: string
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          max_students: number | null
          max_teachers: number | null
          name: string
          phone: string | null
          school_level: string | null
          settings: Json | null
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          max_students?: number | null
          max_teachers?: number | null
          name: string
          phone?: string | null
          school_level?: string | null
          settings?: Json | null
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          max_students?: number | null
          max_teachers?: number | null
          name?: string
          phone?: string | null
          school_level?: string | null
          settings?: Json | null
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          token: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          token: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          token?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      student_enrollments: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string | null
          ended_at: string | null
          enrolled_at: string | null
          id: string
          notes: string | null
          status: string
          student_id: string
          updated_at: string | null
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string | null
          ended_at?: string | null
          enrolled_at?: string | null
          id?: string
          notes?: string | null
          status?: string
          student_id: string
          updated_at?: string | null
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string | null
          ended_at?: string | null
          enrolled_at?: string | null
          id?: string
          notes?: string | null
          status?: string
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_enrollments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_submissions: {
        Row: {
          answers: Json | null
          assignment_id: string | null
          attachments: Json | null
          id: string
          is_late: boolean | null
          is_offline: boolean
          student_id: string | null
          submitted_at: string | null
        }
        Insert: {
          answers?: Json | null
          assignment_id?: string | null
          attachments?: Json | null
          id?: string
          is_late?: boolean | null
          is_offline?: boolean
          student_id?: string | null
          submitted_at?: string | null
        }
        Update: {
          answers?: Json | null
          assignment_id?: string | null
          attachments?: Json | null
          id?: string
          is_late?: boolean | null
          is_offline?: boolean
          student_id?: string | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          angkatan: string | null
          class_id: string | null
          created_at: string | null
          entry_year: number | null
          gender: string | null
          id: string
          nis: string | null
          parent_user_id: string | null
          school_id: string
          school_level: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          angkatan?: string | null
          class_id?: string | null
          created_at?: string | null
          entry_year?: number | null
          gender?: string | null
          id?: string
          nis?: string | null
          parent_user_id?: string | null
          school_id: string
          school_level?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          angkatan?: string | null
          class_id?: string | null
          created_at?: string | null
          entry_year?: number | null
          gender?: string | null
          id?: string
          nis?: string | null
          parent_user_id?: string | null
          school_id?: string
          school_level?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_parent_user_id_fkey"
            columns: ["parent_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_kkm: {
        Row: {
          created_at: string | null
          grade_level: number
          id: string
          kkm: number
          school_id: string | null
          school_level: string
          subject_id: string
        }
        Insert: {
          created_at?: string | null
          grade_level: number
          id?: string
          kkm?: number
          school_id?: string | null
          school_level: string
          subject_id: string
        }
        Update: {
          created_at?: string | null
          grade_level?: number
          id?: string
          kkm?: number
          school_id?: string | null
          school_level?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_kkm_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_kkm_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          created_at: string | null
          id: string
          kkm: number | null
          level: string | null
          name: string
          school_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          kkm?: number | null
          level?: string | null
          name: string
          school_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kkm?: number | null
          level?: string | null
          name?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string | null
          gender: string | null
          id: string
          nip: string | null
          school_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          gender?: string | null
          id?: string
          nip?: string | null
          school_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          gender?: string | null
          id?: string
          nip?: string | null
          school_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teachers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      teaching_assignments: {
        Row: {
          academic_year_id: string | null
          class_id: string | null
          created_at: string | null
          id: string
          subject_id: string | null
          teacher_id: string | null
        }
        Insert: {
          academic_year_id?: string | null
          class_id?: string | null
          created_at?: string | null
          id?: string
          subject_id?: string | null
          teacher_id?: string | null
        }
        Update: {
          academic_year_id?: string | null
          class_id?: string | null
          created_at?: string | null
          id?: string
          subject_id?: string | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teaching_assignments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          full_name: string | null
          id: string
          is_locked: boolean | null
          must_change_password: boolean | null
          password_hash: string
          role: string
          school_id: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          full_name?: string | null
          id?: string
          is_locked?: boolean | null
          must_change_password?: boolean | null
          password_hash: string
          role: string
          school_id?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          full_name?: string | null
          id?: string
          is_locked?: boolean | null
          must_change_password?: boolean | null
          password_hash?: string
          role?: string
          school_id?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_academic_year_cascade: {
        Args: { p_year_id: string }
        Returns: Json
      }
      delete_student: {
        Args: { p_school_id?: string; p_student_id: string }
        Returns: Json
      }
      delete_students_batch: {
        Args: { p_school_id?: string; p_student_ids: string[] }
        Returns: Json
      }
      exam_answer_counts: {
        Args: { p_exam_id: string }
        Returns: {
          answered_count: number
          points_sum: number
          submission_id: string
        }[]
      }
      match_material_chunks: {
        Args: {
          match_count?: number
          match_material_id: string
          query_embedding: string
        }
        Returns: {
          id: string
          page: number
          similarity: number
          text: string
        }[]
      }
      move_student_to_class: {
        Args: {
          p_notes?: string
          p_school_id?: string
          p_student_id: string
          p_to_class_id: string
        }
        Returns: Json
      }
      official_exam_answer_counts: {
        Args: { p_exam_id: string }
        Returns: {
          answered_count: number
          points_sum: number
          submission_id: string
        }[]
      }
      promote_students_batch: {
        Args: { p_graduations?: Json; p_notes?: string; p_targets?: Json }
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
  public: {
    Enums: {},
  },
} as const

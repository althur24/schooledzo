// User roles
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'GURU' | 'SISWA' | 'WALI'

// School levels
export type SchoolLevel = 'SMP' | 'SMA'

// Academic year status
export type AcademicYearStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED'

// Enrollment status for student lifecycle tracking
export type EnrollmentStatus =
    | 'ACTIVE'           // Currently enrolled
    | 'PROMOTED'         // Moved to next grade
    | 'GRADUATED'        // Completed education level
    | 'RETAINED'         // Repeated same grade
    | 'TRANSFERRED_OUT'  // Left school

// Student overall status
export type StudentStatus =
    | 'ACTIVE'           // Currently enrolled
    | 'GRADUATED'        // Completed education
    | 'TRANSFERRED_OUT'  // Left school
    | 'INACTIVE'         // Suspended or other

// School types
export interface School {
    id: string
    name: string
    code: string
    logo_url: string | null
    address: string | null
    phone: string | null
    email: string | null
    school_level: 'SMP' | 'SMA' | 'BOTH' | null
    is_active: boolean
    settings: Record<string, unknown>
    max_students: number
    max_teachers: number
    created_at: string
}

// Database types
export interface User {
    id: string
    username: string
    password_hash: string
    full_name: string | null
    role: UserRole
    school_id: string
    must_change_password?: boolean
    is_locked?: boolean
    created_at: string
    school?: School
}

export interface Session {
    id: string
    user_id: string
    token: string
    expires_at: string
    created_at: string
}

export interface Teacher {
    id: string
    user_id: string
    nip: string | null
    school_id: string
    created_at: string
    user?: User
}

export interface Student {
    id: string
    user_id: string
    nis: string | null
    class_id: string | null
    school_id: string
    angkatan: string | null          // Cohort year, e.g., "2020", "2021"
    entry_year: number | null        // Year when student entered school
    school_level: SchoolLevel | null // Current school level (SMP/SMA)
    status: StudentStatus            // Overall student status
    created_at: string
    user?: User
    class?: Class
    enrollments?: StudentEnrollment[]  // Enrollment history
}

export interface AcademicYear {
    id: string
    name: string
    start_date: string | null        // Start date of academic year
    end_date: string | null          // End date (set when completed)
    status: AcademicYearStatus       // PLANNED, ACTIVE, or COMPLETED
    is_active: boolean               // Legacy field for backward compatibility
    created_at: string
}

export interface Class {
    id: string
    name: string
    grade_level: number | null  // 1, 2, or 3 for class level grouping
    school_level: SchoolLevel | null  // SMP or SMA
    academic_year_id: string
    created_at: string
    academic_year?: AcademicYear
}

export interface StudentEnrollment {
    id: string
    student_id: string
    class_id: string
    academic_year_id: string
    status: EnrollmentStatus
    enrolled_at: string
    ended_at: string | null
    notes: string | null
    created_at: string
    updated_at: string
    // Relations
    student?: Student
    class?: Class
    academic_year?: AcademicYear
}

export interface Subject {
    id: string
    name: string
    kkm?: number | null
    level?: 'UMUM' | 'SMP' | 'SMA' | null
    created_at: string
    teaching_assignments?: { count: number }[]
}

export interface TeachingAssignment {
    id: string
    teacher_id: string
    subject_id: string
    class_id: string
    academic_year_id: string
    created_at: string
    teacher?: Teacher
    subject?: Subject
    class?: Class
    academic_year?: AcademicYear
}

export interface Material {
    id: string
    teaching_assignment_id: string
    title: string
    description: string | null
    type: 'PDF' | 'VIDEO' | 'TEXT' | 'LINK'
    content_url: string | null
    content_text: string | null
    created_at: string
    teaching_assignment?: TeachingAssignment
}

export interface Assignment {
    id: string
    teaching_assignment_id: string
    title: string
    description: string | null
    type: 'TUGAS' | 'ULANGAN'
    due_date: string | null
    created_at: string
    teaching_assignment?: TeachingAssignment
}

export interface Question {
    id: string
    assignment_id: string
    type: 'PG' | 'ESSAY' | string // Legacy, use QuestionType instead
    question: string
    options: string[] | null
    correct_answer: string | null
    points: number
    created_at: string
}

export interface SubmissionAttachment {
    url: string
    name: string
    type: string   // MIME type
    size: number   // bytes
}

export interface StudentSubmission {
    id: string
    assignment_id: string
    student_id: string
    answers: any[] | null
    submitted_at: string
    attachments: SubmissionAttachment[] | null
    is_late: boolean
    assignment?: Assignment
    student?: Student
}

export interface Grade {
    id: string
    submission_id: string
    score: number
    feedback: string | null
    graded_at: string
    submission?: StudentSubmission
}

// Auth context type
export interface AuthUser {
    id: string
    username: string
    full_name: string | null
    role: UserRole
    school_id: string | null  // null for SUPER_ADMIN
    school_name?: string | null
    must_change_password?: boolean
    is_locked?: boolean
}

// Quiz types
export type QuestionType = 'MULTIPLE_CHOICE' | 'MULTIPLE_ANSWER' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'

export interface Quiz {
    id: string
    teaching_assignment_id: string
    title: string
    description: string | null
    duration_minutes: number
    is_randomized: boolean
    is_active: boolean
    created_at: string
    updated_at: string
    teaching_assignment?: TeachingAssignment
    questions?: QuizQuestion[]
}

export interface QuizQuestion {
    id: string
    quiz_id: string
    question_text: string
    question_type: QuestionType
    options: string[] | null
    correct_answer: string | null
    difficulty?: Difficulty
    points: number
    order_index: number
    created_at: string
}

export interface QuizSubmission {
    id: string
    quiz_id: string
    student_id: string
    started_at: string
    submitted_at: string | null
    answers: QuizAnswer[] | null
    total_score: number
    max_score: number
    is_graded: boolean
    quiz?: Quiz
    student?: Student
}

export interface QuizAnswer {
    question_id: string
    answer: string
    is_correct?: boolean
    score?: number
}

export interface QuestionBank {
    id: string
    teacher_id: string
    subject_id: string | null
    question_text: string
    question_type: QuestionType
    options: string[] | null
    correct_answer: string | null
    difficulty: Difficulty | string
    tags: string[] | null
    created_at: string
    subject?: Subject
}

// Batch Operation Types for Student Lifecycle Management
// (The legacy /api/batch/promote and /api/batch/graduate endpoints were removed;
//  kenaikan kelas now uses /api/batch/promote-students -> promote_students_batch RPC.)


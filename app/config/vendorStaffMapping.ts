/**
 * Vendor-Staff Mapping Configuration
 * 
 * This maps staff email addresses to their assigned vendor names.
 * Later, this will be replaced with a database-driven UI for admins.
 */

export interface VendorStaffMapping {
  [staffEmail: string]: string;
}

export const VENDOR_STAFF_MAPPING: VendorStaffMapping = {
  // Example mappings - replace with your actual staff emails and vendor names
  "vendor1@example.com": "Nike",
  "vendor2@example.com": "Acme Supplies",
  "test-vendor@example.com": "Test Vendor",
  "ojzeeaaron@gmail.com": "Hydrogen Vendor",
  // Add your test staff email here:
  // "your-staff-email@example.com": "Your Vendor Name",
};

/**
 * Get the vendor name assigned to a staff member
 * @param staffEmail - The email address of the staff member
 * @returns The vendor name if assigned, null if not assigned (admin/owner)
 */
export function getVendorForStaff(staffEmail: string): string | null {
  return VENDOR_STAFF_MAPPING[staffEmail] || null;
}

/**
 * Check if a staff member is assigned to a specific vendor
 * @param staffEmail - The email address of the staff member
 * @param vendorName - The vendor name to check
 * @returns True if the staff is assigned to the vendor
 */
export function isStaffAssignedToVendor(staffEmail: string, vendorName: string): boolean {
  const assignedVendor = getVendorForStaff(staffEmail);
  return assignedVendor === vendorName;
}

/**
 * Get all configured vendors
 * @returns Array of unique vendor names
 */
export function getAllVendors(): string[] {
  return Array.from(new Set(Object.values(VENDOR_STAFF_MAPPING)));
}

import { HttpStatus } from '@nestjs/common';
import { ErrorResponseDTO } from '../common-dto/response/error-response.dto.js';

/**
 * Reusable factories — each returns a pre-filled ErrorResponseDTO suitable
 * for throwing directly into `new UnauthorizedException(invalidToken())`.
 *
 * Keep these factories pure and dumb. Add more (productNotFound,
 * outstandingExceeded, etc.) as modules grow.
 */

export const invalidToken = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Invalid or missing authentication token',
    [
      'The Bearer token is missing, has expired, or its signature does not match.',
    ],
    HttpStatus.UNAUTHORIZED,
  );
};

export const invalidOwnerPhone = (phone: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'That is not a valid phone number',
    [
      `${phone} is not a Pakistani mobile number. Use the form 03XX1234567, or with a country code 923XX1234567. The phone number is the owner's login id, so it must be one he actually owns.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const ownerPhoneAlreadyRegistered = (
  phone: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'This phone number already has a Dukaan Pro account',
    [
      `${phone} is already linked to another shop. A phone number can only own one shop, so find that shop and reissue its setup link instead of creating a duplicate.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const oneOwnerPerShop = (shopName: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `${shopName} already has an owner`,
    [
      'Only one owner per shop is supported in the current release. Issue a new setup link for the existing owner instead of adding another.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const invalidSubscriptionDate = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Subscription end date is not a valid date',
    [
      'Send an ISO-8601 date such as 2027-01-15T00:00:00.000Z, or a plain date such as 2027-01-15.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const subscriptionEndInPast = (date: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Subscription end date must be in the future',
    [
      `${date} is already in the past, which would leave the shop suspended right away. Pick a future date, or send isActive: false if the intent was to suspend it.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const invalidCredentials = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Phone number or password is incorrect',
    [
      'The phone number or password you entered is not correct. Check both and try again.',
    ],
    HttpStatus.UNAUTHORIZED,
  );
};

export const adminAccountDisabled = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Platform admin account is disabled',
    [
      'This Dukaan Pro staff account has been deactivated. Ask another administrator to re-enable it.',
    ],
    HttpStatus.FORBIDDEN,
  );
};

export const shopSuspended = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Shop is suspended',
    [
      'Your shop subscription has ended or been suspended. Contact Dukaan Pro support to renew.',
    ],
    HttpStatus.FORBIDDEN,
  );
};

export const userSuspended = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'User account is disabled',
    [
      'This user has been suspended. Only the shop owner or Dukaan Pro support can re-enable it.',
    ],
    HttpStatus.FORBIDDEN,
  );
};

export const resourceNotFound = (
  name: string,
  id?: string,
): ErrorResponseDTO => {
  const what = id ? `${name} with ID ${id}` : `${name}`;
  return new ErrorResponseDTO(
    `${what} not found`,
    [
      `The ${what} either does not exist, belongs to another shop, or has been deactivated / cancelled.`,
    ],
    HttpStatus.NOT_FOUND,
  );
};

export const invalidSetupToken = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Invalid or expired setup link',
    [
      'This password-setup link has been used already or has expired. Request a new link from your shop admin.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const currentPasswordIncorrect = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Current password is incorrect',
    [
      'The current password you typed does not match. Re-enter it and try again.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const insufficientStock = (
  productName: string,
  available: number,
  requested: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Insufficient stock for ${productName}`,
    [
      `Only ${available} unit(s) of ${productName} are available but the sale requires ${requested}.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const outstandingExceeded = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Payment amount exceeds current outstanding',
    [
      'The amount you are trying to record is larger than the current balance owed. Check the customer or supplier ledger.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const cancelledRowMutationForbidden = (
  name: string,
  id: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Cannot modify a cancelled ${name}`,
    [
      `${name} (${id}) is in CANCELLED status and cannot be edited. Create a new record instead.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const duplicateName = (
  name: string,
  value: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `${name} "${value}" already exists`,
    [
      `Another ${name.toLowerCase()} with this name already exists in your shop. Please pick a different name.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const systemRowProtected = (name: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Cannot edit or deactivate the system ${name}`,
    [
      `The default "${name}" row is used by other workflows and cannot be renamed or removed.`,
    ],
    HttpStatus.FORBIDDEN,
  );
};

/**
 * A required, non-nullable column was sent as `null`. `@IsOptional()` lets
 * null past validation, so the service has to catch it — otherwise we 500.
 */
export const requiredFieldCannotBeNull = (
  entityName: string,
  fieldLabel: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `${entityName} ${fieldLabel.toLowerCase()} cannot be null`,
    [
      `${fieldLabel} is required on a ${entityName.toLowerCase()}, so it cannot be cleared. Send a value instead, or omit the field entirely to leave it unchanged.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const duplicateFieldValue = (
  name: string,
  fieldLabel: string,
  value: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `${name} ${fieldLabel} "${value}" already exists`,
    [
      `Another ${name.toLowerCase()} in your shop already uses this ${fieldLabel}. ${fieldLabel} must be unique inside a shop, so pick a different one.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const trackingTypeLocked = (name: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Cannot change the stock tracking type of "${name}"`,
    [
      `"${name}" already has purchase or sale history, so its tracking type (QUANTITY or SERIALIZED) is locked. Changing it now would make every existing stock record wrong. Create a new product instead.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const stockNotEmptyForTrackingChange = (
  name: string,
  quantityOnHand: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Cannot switch "${name}" to SERIALIZED while it still has stock`,
    [
      `"${name}" still shows ${quantityOnHand} unit(s) on hand with no purchase or sale history to explain them. Set the stock to zero first, then switch the product to SERIALIZED.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const purchasePaidExceedsTotal = (
  totalAmount: number,
  paidNow: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Paid amount is more than the purchase total',
    [
      `This purchase totals ${totalAmount} paisa but ${paidNow} paisa was marked as paid. You cannot pay a supplier more than the bill. Lower the paid amount, or raise a line quantity or cost.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const openingStockCannotTakePayment = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Opening stock cannot record a payment',
    [
      'An opening-stock purchase is Day-0 data: it only fills the shelves, it has no bill and no cash leaves the drawer. Set paidNow to 0, or turn off isOpeningStock to record a real purchase.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const openingCashAlreadySet = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Opening cash already recorded',
    [
      'This shop already has an opening cash entry, and opening cash can only be set once — the cash ledger is append-only. Later changes belong to real payments, expenses or purchases, not another opening entry.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const imeisCountMismatch = (
  productName: string,
  quantity: number,
  imeiCount: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `IMEI count does not match quantity for ${productName}`,
    [
      `${quantity} unit(s) of "${productName}" were ordered but ${imeiCount} IMEI(s) were supplied. Every phone needs exactly one IMEI, so the two numbers must match.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const imeisNotAllowed = (productName: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `IMEIs are not allowed for ${productName}`,
    [
      `"${productName}" is tracked by quantity, not by IMEI. Remove the imeis list from this line — accessories only need a quantity.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const duplicateImei = (imei: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `IMEI ${imei} is already in inventory`,
    [
      `A phone with IMEI ${imei} already exists in this shop (from an earlier purchase, or listed twice on this one). IMEIs must be unique inside a shop, so fix the number before saving.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const paymentExceedsOutstanding = (
  payeeName: string,
  amount: number,
  remaining: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Payment amount exceeds what is left to pay',
    [
      `You are trying to pay ${amount} paisa but only ${remaining} paisa is left to ${payeeName}. Lower the amount, or pick a different bill.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const purchaseSupplierMismatch = (
  purchaseNo: string,
  supplierName: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'That bill does not belong to this supplier',
    [
      `Purchase ${purchaseNo} was made from ${supplierName}, which is not the supplier you selected. Pay the right supplier, or drop purchaseId to pay down the opening balance instead.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const purchaseHasNoPayable = (purchaseNo: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Purchase ${purchaseNo} has no bill to pay`,
    [
      `An opening-stock purchase is Day-0 data — it only filled the shelves, so nothing is owed on it. Drop purchaseId to pay this supplier's opening balance, or pick a real purchase.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const countedQuantityRequired = (
  productName: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `ADJUSTMENT on "${productName}" needs countedQuantity`,
    [
      `"${productName}" is counted by quantity, so an ADJUSTMENT must send countedQuantity — the real number you found on the shelf. The system writes the difference (counted − system), never the typed number itself.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const quantityRequired = (productName: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `DAMAGED or LOST on "${productName}" needs quantity`,
    [
      `"${productName}" is counted by quantity, so tell the system how many units are damaged or lost with a positive quantity. The system removes exactly that many from stock.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unitIdRequired = (productName: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `DAMAGED or LOST on "${productName}" needs inventoryUnitId`,
    [
      `"${productName}" is a phone: every unit is one physical row with its own status. Send inventoryUnitId so the system can mark that exact phone as damaged or lost.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const adjustmentNotAllowedForSerialized = (
  productName: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `ADJUSTMENT is not allowed on "${productName}"`,
    [
      `"${productName}" is tracked as individual phones, so counting has nothing to adjust — there is no shelf-count number to type. Mark a specific phone as DAMAGED or LOST instead.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unwantedAdjustmentField = (
  productName: string,
  type: string,
  field: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `\`${field}\` is not accepted for ${type} on "${productName}"`,
    [
      `A ${type} stock change on "${productName}" does not use ${field}. Send only the fields this change needs, and read the plan for which product kinds use which field.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unitNotInStock = (
  productName: string,
  imei: string,
  status: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'This phone cannot be marked damaged or lost',
    [
      `The phone with ${imei} of "${productName}" is currently ${status}, so it is not sitting on the shelf for damage or loss. Only an IN_STOCK phone can be marked damaged or lost.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unitNotAvailableForSale = (
  productName: string,
  imei: string,
  status: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'This phone is not available to sell',
    [
      `The phone with IMEI ${imei} of "${productName}" is currently ${status}. Only an IN_STOCK phone in this shop can be sold — pick another IMEI.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const customerRequiredForSale = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'This sale needs a customer',
    [
      'A sale that includes a phone, or that leaves any amount unpaid (Udhar), cannot be walk-in. Pick a customer first.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const discountExceedsSubtotal = (
  discount: number,
  subtotal: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'The discount is bigger than the sale subtotal',
    [
      `A discount of ${discount} paisa cannot be applied to a subtotal of ${subtotal} paisa. Reduce the discount so it fits inside the subtotal.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const salePaidExceedsTotal = (
  total: number,
  paidNow: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'The paid amount is bigger than the sale total',
    [
      `You marked ${paidNow} paisa as paid but the sale total is ${total} paisa. The unpaid part of a sale cannot be negative — reduce the paid amount.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unwantedSaleItemField = (
  productName: string,
  field: string,
  reason: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `\`${field}\` is not valid on this sale line`,
    [
      `The line for "${productName}" ${reason}. Fix \`${field}\` and save again.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const purchaseCancelUnitNotInStock = (
  purchaseNo: string,
  imei: string,
  status: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Purchase ${purchaseNo} cannot be cancelled`,
    [
      `The phone with IMEI ${imei} from this purchase is currently ${status}, not IN_STOCK. Cancelling would put a sold, damaged or lost phone back on the shelf as if it were never gone, so the purchase stays until that phone is IN_STOCK again.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const saleCancelUnitNotSold = (
  saleNo: string,
  imei: string,
  status: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Sale ${saleNo} cannot be cancelled`,
    [
      `The phone with IMEI ${imei} sold on this sale is currently ${status}, not SOLD, so there is no sold stock to put back. Fix the phone's status first, then cancel the sale.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const inventoryUnitIdRequiredForSale = (
  productName: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'This sale line needs inventoryUnitId',
    [
      `"${productName}" is tracked as individual phones, so the line must name the exact phone being sold with inventoryUnitId. Pick an IN_STOCK IMEI from the list.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

// ---------------------------------------------------------------------------
// Release 1.2 — Online Store
// ---------------------------------------------------------------------------

/**
 * WF22 step 3 — missing slug, switched-off store and suspended shop MUST be
 * indistinguishable, so every one of them answers with this exact body.
 */
export const storeNotAvailable = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Store not available',
    ['This store is not available right now.'],
    HttpStatus.NOT_FOUND,
  );
};

export const slugReserved = (slug: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `The store name "${slug}" cannot be used`,
    [
      `${slug} is a reserved store address (e.g. "admin", "api", "www"). Pick a different one.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const productNotPublishable = (
  productName: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `"${productName}" cannot be published`,
    [
      'Only an active product can appear in the public store. Reactivate the product first, then publish it.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const imageLimitExceeded = (
  productName: string,
  max: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Too many images on "${productName}"`,
    [
      `A product can carry at most ${max} photos. Remove an old one before adding another.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const reorderImageMismatch = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Image order does not match the product',
    [
      'imageIds must contain every photo of this product exactly once. Compare what was sent with what is already saved.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unsupportedImageType = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Photo is not a supported image',
    [
      'Only real JPEG, PNG or WebP files are accepted (checked by content, not by the file name).',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const photoFileRequired = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Photo is required',
    ['Send the image file in the multipart field named "image".'],
    HttpStatus.BAD_REQUEST,
  );
};

// ---------------------------------------------------------------------------
// Release 1.1 — Returns & refunds (WF15)
// ---------------------------------------------------------------------------

export const saleHasReturns = (saleNo: string): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Sale ${saleNo} cannot be cancelled`,
    [
      `Sale ${saleNo} already has returns against it, and a sale with returns can only be fixed by cancelling the returns — never by cancelling the sale. The original sale, its payments and the returns must all stay as history.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const returnQuantityExceedsRemaining = (
  saleNo: string,
  productName: string,
  requested: number,
  remaining: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Cannot return that many of ${productName}`,
    [
      `Sale ${saleNo} sold and still shows only ${remaining} unit(s) of "${productName}" left to return (sold minus already returned), but the request asks for ${requested}. Lower the quantity or check the returns already recorded.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unitAlreadyReturned = (
  saleNo: string,
  imei: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'That phone was already returned',
    [
      `The phone with IMEI ${imei} sold on sale ${saleNo} appears in an earlier return. One IMEI can be returned only once, so this line was refused.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unitNotSoldForReturn = (
  saleNo: string,
  imei: string,
  status: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'This phone cannot be returned',
    [
      `The phone with IMEI ${imei} sold on sale ${saleNo} is currently ${status}, not SOLD, so there is no sold unit to take back. Fix the phone's status first, then retry the return.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const returnQuantityRequired = (
  productName: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `Return line for "${productName}" needs quantity`,
    [
      `"${productName}" is tracked by quantity, so say how many units are being returned (sold minus already returned). The phone lines do not need this — one IMEI is one unit.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const unwantedReturnItemField = (
  productName: string,
  field: string,
  reason: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    `\`${field}\` is not valid on this return line`,
    [
      `The return line for "${productName}" ${reason}. Fix \`${field}\` and save again.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const refundExceedsAvailable = (
  refundAmount: number,
  available: number,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Refund is more than can be given back',
    [
      `The refund is ${refundAmount} paisa but only ${available} paisa can be returned in cash right now. The return value first cancels the Udhar still owed on the sale, and a refund can never exceed what the customer actually paid (minus earlier refunds). Lower the refund — 0 is allowed.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const cashReconciliationReasonRequired = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Reason required for the difference',
    [
      'The counted cash and the system cash do not match, so a reason is required to record this reconciliation. Explain what happened (for example "wrong change given") — it keeps the ledger honest.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const invalidReportRange = (
  from: string,
  to: string,
): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Report range is backwards',
    [
      `The report starts at ${from} and ends at ${to}, but the start comes after the end. Swap the two dates and try again.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const reportPeriodTooLong = (days: number): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Report range is too long',
    [
      `This report covers ${days} days, more than the 366 limit. Pick a shorter range — a month or a quarter is easier to scan, and you can export any range you like since the CSV shows every row.`,
    ],
    HttpStatus.BAD_REQUEST,
  );
};

export const pdfExportNotAvailable = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'PDF export is coming later',
    [
      'Ask for format=csv for now — every report downloads exactly the same rows as the CSV. PDF is a separate ticket.',
    ],
    HttpStatus.BAD_REQUEST,
  );
};

/** WF22 step 8 — the public storefront is rate limited per IP. */
export const tooManyRequests = (): ErrorResponseDTO => {
  return new ErrorResponseDTO(
    'Too many requests',
    [
      'You have hit the request limit for the public store this minute. Wait a moment and try again.',
    ],
    HttpStatus.TOO_MANY_REQUESTS,
  );
};

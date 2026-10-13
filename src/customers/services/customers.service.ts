import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Customer } from '../../generated/prisma/client.js';
import { RecordStatus } from '../../generated/prisma/enums.js';
import { CreateCustomerDto } from '../dto/create-customer.dto.js';
import { UpdateCustomerDto } from '../dto/update-customer.dto.js';
import { CustomerQueryFilterDto } from '../dto/customer-query.filter.js';
import { LedgerQueryFilterDto } from '../dto/ledger-query.filter.js';
import { ResponseCustomerDto } from '../dto/response-customer.dto.js';
import { CustomerLedgerDto } from '../dto/response-customer-ledger.dto.js';
import { LedgerEntryDto } from '../../common-dto/response/ledger-entry.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import {
  normalizePhone,
  normalizePhoneOrRaw,
} from '../../helpers/phone.helper.js';
import {
  requiredFieldCannotBeNull,
  resourceNotFound,
} from '../../errors/error.builder.js';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCustomer(
    dto: CreateCustomerDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // Customer names and phones are not unique, so there is no duplicate check.
    await this.prisma.customer.create({
      data: {
        shopId,
        name: dto.name.trim(),
        phone: dto.phone ? normalizePhoneOrRaw(dto.phone) : null,
        address: dto.address?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
        openingBalance: BigInt(dto.openingBalance ?? 0),
        isActive: dto.isActive ?? true,
      },
    });
    // TODO(ai): append audit log once audit-log module is added
    return new StatusBaseResponseDTO(true, 'Customer created successfully');
  }

  async getCustomers(
    query: CustomerQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseCustomerDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: any = { shopId };
    const search = query.search?.trim();
    if (search) {
      const branches: any[] = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
      // Rows store 923001234567 but the owner types 03001234567 — match both.
      const canonical = normalizePhone(search);
      if (canonical && canonical !== search) {
        branches.push({ phone: { contains: canonical } });
      }
      where.OR = branches;
    }
    if (query.isActive !== undefined && query.isActive !== null) {
      where.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseCustomerDto>(
      items.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize,
    );
  }

  async getCustomerById(
    id: string,
    shopId: string,
  ): Promise<ResponseCustomerDto> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, shopId },
    });
    if (!customer) {
      throw new NotFoundException(resourceNotFound('Customer', id));
    }
    return this.toResponse(customer);
  }

  /**
   * WF11 — the customer's Udhar history. There is no ledger table: every line
   * is a real sale, payment, return or refund row, so the ledger can never
   * disagree with them. Cancelled rows stay visible with delta 0 (WF12 rule) and the balance is
   * derived over the whole timeline before paging, so page 2 of the timeline
   * still shows balances that include page 1.
   */
  async getCustomerLedger(
    id: string,
    query: LedgerQueryFilterDto,
    shopId: string,
  ): Promise<CustomerLedgerDto> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      200,
    );

    const customer = await this.prisma.customer.findFirst({
      where: { id, shopId },
      select: { id: true, name: true, openingBalance: true },
    });
    if (!customer) {
      throw new NotFoundException(resourceNotFound('Customer', id));
    }

    const [sales, payments, returns] = await Promise.all([
      this.prisma.sale.findMany({
        where: { shopId, customerId: id },
        select: {
          id: true,
          saleNo: true,
          saleDate: true,
          createdAt: true,
          totalAmount: true,
          status: true,
          notes: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { shopId, customerId: id },
        select: {
          id: true,
          saleId: true,
          amount: true,
          paymentDate: true,
          createdAt: true,
          status: true,
          notes: true,
        },
      }),
      this.prisma.saleReturn.findMany({
        where: { shopId, customerId: id },
        select: {
          id: true,
          saleId: true,
          returnDate: true,
          createdAt: true,
          returnAmount: true,
          status: true,
          reason: true,
          refunds: {
            select: {
              id: true,
              amount: true,
              refundDate: true,
              createdAt: true,
              notes: true,
            },
          },
        },
      }),
    ]);

    const saleNoById = new Map(sales.map((s) => [s.id, s.saleNo]));

    type RawEntry = Omit<LedgerEntryDto, 'amount' | 'delta' | 'balance'> & {
      sortAt: number;
      createdAt: number;
      amount: bigint;
      delta: bigint;
    };

    const raws: RawEntry[] = [
      ...sales.map<RawEntry>((s) => ({
        id: s.id,
        type: 'SALE',
        date: s.saleDate.toISOString(),
        reference: s.saleNo,
        notes: s.notes,
        status: s.status,
        sortAt: s.saleDate.getTime(),
        createdAt: s.createdAt.getTime(),
        amount: s.totalAmount,
        delta: s.status === RecordStatus.ACTIVE ? s.totalAmount : 0n,
      })),
      ...payments.map<RawEntry>((p) => ({
        id: p.id,
        type: 'PAYMENT',
        date: p.paymentDate.toISOString(),
        // A payment with no sale is paying the opening balance, not a bill.
        reference: p.saleId ? (saleNoById.get(p.saleId) ?? null) : null,
        notes: p.notes,
        status: p.status,
        sortAt: p.paymentDate.getTime(),
        createdAt: p.createdAt.getTime(),
        amount: p.amount,
        delta: p.status === RecordStatus.ACTIVE ? -p.amount : 0n,
      })),
      // WF15: a return gives goods back (balance falls), a refund gives cash
      // back (balance rises). Both are sale-scoped, so both show the saleNo.
      ...returns.flatMap<RawEntry>((r) => [
        {
          id: r.id,
          type: 'RETURN',
          date: r.returnDate.toISOString(),
          reference: saleNoById.get(r.saleId) ?? null,
          notes: r.reason,
          status: r.status,
          sortAt: r.returnDate.getTime(),
          createdAt: r.createdAt.getTime(),
          amount: r.returnAmount,
          delta: r.status === RecordStatus.ACTIVE ? -r.returnAmount : 0n,
        },
        ...r.refunds.map<RawEntry>((refund) => ({
          id: refund.id,
          type: 'REFUND',
          date: refund.refundDate.toISOString(),
          reference: saleNoById.get(r.saleId) ?? null,
          notes: refund.notes ?? r.reason,
          status: 'ACTIVE',
          sortAt: refund.refundDate.getTime(),
          createdAt: refund.createdAt.getTime(),
          amount: refund.amount,
          delta: refund.amount,
        })),
      ]),
    ].sort(
      (a, b) =>
        a.sortAt - b.sortAt ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );

    let running = customer.openingBalance;
    const all: LedgerEntryDto[] = raws.map((r) => {
      running += r.delta;
      return {
        id: r.id,
        type: r.type,
        date: r.date,
        reference: r.reference,
        notes: r.notes,
        status: r.status,
        amount: Number(r.amount),
        delta: Number(r.delta),
        balance: Number(running),
      };
    });

    const skip = getSkipNumber(page, pageSize);
    return {
      customerId: customer.id,
      customerName: customer.name,
      openingBalance: Number(customer.openingBalance),
      balance: Number(running),
      page,
      pageSize,
      total: all.length,
      items: all.slice(skip, skip + pageSize),
    };
  }

  async updateCustomer(
    id: string,
    dto: UpdateCustomerDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // @IsOptional() lets `null` past validation, so null has to be handled
    // here: nullable columns are cleared, the required name is a 400.
    const data: any = {};
    if (dto.name !== undefined) {
      if (dto.name === null) {
        throw new BadRequestException(
          requiredFieldCannotBeNull('Customer', 'Name'),
        );
      }
      data.name = dto.name.trim();
    }
    if (dto.phone !== undefined) {
      data.phone = dto.phone === null ? null : normalizePhoneOrRaw(dto.phone);
    }
    if (dto.address !== undefined) {
      data.address = dto.address === null ? null : dto.address.trim();
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes === null ? null : dto.notes.trim();
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.openingBalance !== undefined) {
      data.openingBalance = BigInt(dto.openingBalance);
    }

    const result = await this.prisma.customer.updateMany({
      where: { id, shopId },
      data,
    });
    if (result.count === 0) {
      throw new NotFoundException(resourceNotFound('Customer', id));
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(true, 'Customer updated successfully');
  }

  async deleteCustomer(
    id: string,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const result = await this.prisma.customer.updateMany({
      where: { id, shopId },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException(resourceNotFound('Customer', id));
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(true, 'Customer deactivated successfully');
  }

  /** openingBalance is a bigint in the database; JSON cannot serialize bigint. */
  private toResponse(customer: Customer): ResponseCustomerDto {
    return { ...customer, openingBalance: Number(customer.openingBalance) };
  }
}

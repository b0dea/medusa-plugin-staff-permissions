import { Module } from "@medusajs/framework/utils"
import StaffAccessModuleService from "./service"

export const STAFF_ACCESS_MODULE = "staffAccess"

export default Module(STAFF_ACCESS_MODULE, { service: StaffAccessModuleService })

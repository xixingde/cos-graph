/**
 * Tests for the Terraform/HCL extractor.
 */
import { describe, it, expect, test } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// extractTerraform not yet migrated to TS
// import { extractTerraform } from "../src/extract/index.js";

function _write(dir: string, name: string, body: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, "utf-8");
  return p;
}

function _labels(r: Record<string, unknown>): string[] {
  return ((r.nodes ?? []) as Array<Record<string, unknown>>).map(
    (n) => String(n.label ?? ""),
  );
}

function _relPairs(r: Record<string, unknown>, relation: string): Set<[string, string]> {
  const lab = new Map(
    ((r.nodes ?? []) as Array<Record<string, unknown>>).map(
      (n) => [String(n.id), String(n.label ?? "")],
    ),
  );
  const pairs = new Set<[string, string]>();
  for (const e of (r.edges ?? []) as Array<Record<string, unknown>>) {
    if (e.relation === relation) {
      pairs.add([
        lab.get(String(e.source)) ?? String(e.source),
        lab.get(String(e.target)) ?? String(e.target),
      ]);
    }
  }
  return pairs;
}

const SAMPLE = `\
# leading comment so the body is not children[0]
terraform {
  required_providers { azurerm = { source = "hashicorp/azurerm" } }
}

variable "region" { default = "us-east-1" }

provider "aws" { region = var.region }

data "aws_ami" "ubuntu" { most_recent = true }

resource "aws_instance" "web" {
  ami       = data.aws_ami.ubuntu.id
  subnet_id = var.region
  depends_on = [aws_security_group.sg]
}

resource "aws_security_group" "sg" { name = "sg" }

module "vpc" {
  source = "./modules/vpc"
  cidr   = local.cidr
}

locals { cidr = "10.0.0.0/16" }

output "ip" { value = aws_instance.web.private_ip }
`;

describe.skip("Terraform extraction — extractTerraform not yet migrated", () => {
  it("no error and all block types become nodes", () => {});
  it("reference edges", () => {});
  it("depends_on edge", () => {});
  it("file contains blocks", () => {});
  it("meta heads not emitted", () => {});
  it("build from json integration", () => {});
});

package org.ecotwin.core;

/** Invalid simulation data. Transport adapters choose their own error representation. */
public final class SimulationValidationException extends IllegalArgumentException {
    public SimulationValidationException(String message) { super(message); }
}
